/**
 * Full-mesh WebRTC rooms: one RTCPeerConnection per remote peer, signaled
 * through /api/rtc (see signaling.server.ts), game data flowing directly
 * browser-to-browser afterwards. Client-authoritative by construction — see
 * the multiplayer-p2p skill for when NOT to use this.
 *
 * Negotiation follows the "perfect negotiation" pattern: on a glare (both
 * sides offering at once) the polite peer — the lexicographically smaller id —
 * rolls back and accepts, so pairs converge without wedging.
 */

export type SignalKind = "offer" | "answer" | "ice";

/**
 * Wire contract between this client and the signaling relay the app provides
 * at /api/rtc (see the multiplayer-p2p skill for a reference implementation).
 * The client only needs these shapes — the relay's storage is the app's choice.
 */
export interface PeerRow {
  id: string;
  name: string;
}
export interface SignalRow {
  id: number;
  from: string;
  kind: SignalKind;
  payload: unknown;
}
export interface RtcPollResponse {
  peers: PeerRow[];
  signals: SignalRow[];
}

export interface PeerInfo {
  id: string;
  name: string;
  connectionState: RTCPeerConnectionState;
  /** Selected local ICE candidate type: host | srflx | prflx | relay. */
  candidateType: string | null;
  /** Data-channel ping RTT (ms), measured every 2s once connected. */
  rttMs: number | null;
}

export interface P2PRoomOptions {
  room: string;
  selfId: string;
  name?: string;
  /** Defaults to VITE_STUN_URLS (comma-separated) or Google public STUN. */
  iceServers?: RTCIceServer[];
  onPeersChanged?: (peers: PeerInfo[]) => void;
  /** Fires for both the unreliable "state" and reliable "reliable" channels. */
  onMessage?: (from: string, data: unknown, channel: "state" | "reliable") => void;
  /** Fires once, on the first successful signaling poll (registration). */
  onConnected?: () => void;
}

interface PeerSlot {
  pc: RTCPeerConnection;
  state?: RTCDataChannel;
  reliable?: RTCDataChannel;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** ICE candidates that arrived before the remote description (buffered). */
  pendingCandidates: RTCIceCandidateInit[];
  /** Last time this pair made observable progress toward connected. */
  lastProgressAt: number;
  /** Watchdog recreations (dialer) / stall windows (receiver) so far. */
  recoveryAttempts: number;
  /** Gave up after MAX_RECOVERY_ATTEMPTS — excluded from fast-poll pressure. */
  terminal?: boolean;
  /** One-shot: pc was already recreated to absorb a failing remote offer. */
  recreatedForOffer?: boolean;
  info: PeerInfo;
  pingSentAt?: number;
  audioSender?: RTCRtpSender;
  playback?: HTMLAudioElement;
  voiceIn?: MediaStreamAudioSourceNode;
  incoming?: MediaStream;
}

const FAST_POLL_MS = 400;
const IDLE_POLL_MS = 2000;
const PING_INTERVAL_MS = 2000;
const STALL_MS = 10_000;

/** Public room relay. GitHub Pages is static, so the meadow calls this. */
export const PUBLIC_RTC_URL = "https://vibe-rtc.morning-myth-634.workers.dev/api/rtc";

export function rtcBase(): string {
  if (typeof location !== "undefined" && location.hostname.endsWith("github.io")) return PUBLIC_RTC_URL;
  return "/api/rtc";
}
const MAX_RECOVERY_ATTEMPTS = 3;
const SIGNAL_RETRY_DELAYS_MS = [250, 750];

export function defaultIceServers(): RTCIceServer[] {
  const urls = (import.meta.env.VITE_STUN_URLS as string | undefined)
    ?.split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  // Two independent providers: ICE queries all of them in parallel during
  // gathering, so either one being unreachable costs nothing.
  return [
    {
      urls: urls?.length ? urls : ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
    },
  ];
}

export class P2PRoom {
  private readonly opts: P2PRoomOptions;
  private readonly peers = new Map<string, PeerSlot>();
  /** Per-remote-peer signal delivery chains (order-preserving). */
  private readonly signalQueues = new Map<string, Promise<void>>();
  private cursor = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private everPolled = false;
  private misses = 0;
  private lastPeersFingerprint = "";
  private mic: MediaStream | null = null;
  private micPromise: Promise<"ok" | "no-mic"> | null = null;
  private voicePeer: string | null = null;
  private voiceCtx: AudioContext | null = null;

  constructor(opts: P2PRoomOptions) {
    this.opts = opts;
  }

  /**
   * The first poll IS the join: it registers this peer and returns the
   * roster. A failed first poll (cold DB, offline tab) must not strand the
   * room: the loop and timers start regardless and the next poll retries.
   */
  async join(): Promise<void> {
    try {
      await this.pollOnce();
    } catch {
      // First poll can fail transiently; the scheduled loop below retries.
    }
    if (this.closed) return;
    this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
    this.pingTimer = setInterval(() => {
      this.pingAll();
      this.watchdog();
    }, PING_INTERVAL_MS);
  }

  close(): void {
    this.closed = true;
    this.endVoice();
    void this.voiceCtx?.close().catch(() => undefined);
    this.voiceCtx = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const slot of this.peers.values()) slot.pc.close();
    this.peers.clear();
    // Leaving the roster is the teardown broadcast: everyone's next poll
    // drops this peer and closes their side of the pair.
    void fetch(rtcBase(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "leave", room: this.opts.room, peer: this.opts.selfId }),
      keepalive: true,
    }).catch(() => {});
  }

  /** Send on the unreliable game-state channel (drops stale packets). */
  broadcast(data: unknown): void {
    const wire = JSON.stringify({ t: "d", d: data });
    for (const slot of this.peers.values()) {
      if (slot.state?.readyState === "open") slot.state.send(wire);
    }
  }

  /** Send reliably (ordered) to one peer, or to all when peerId is omitted. */
  send(data: unknown, peerId?: string): void {
    const wire = JSON.stringify({ t: "d", d: data });
    const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
    for (const slot of targets) {
      if (slot?.reliable?.readyState === "open") slot.reliable.send(wire);
    }
  }

  setName(name: string) {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!clean) return;
    this.opts.name = clean;
  }

  /** Start the mic and the speaker inside the button tap. Call this before any await. */
  primeVoice(peerId: string): Promise<"ok" | "no-mic"> {
    if (!this.micPromise) {
      const live = this.mic?.getAudioTracks().some((track) => track.readyState === "live");
      if (live) this.micPromise = Promise.resolve("ok");
      else if (!navigator.mediaDevices?.getUserMedia) this.micPromise = Promise.resolve("no-mic");
      else {
        const pending = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.micPromise = pending
          .then((stream) => {
            this.mic = stream;
            return "ok" as const;
          })
          .catch(() => {
            this.micPromise = null;
            return "no-mic" as const;
          });
      }
    }
    const slot = this.peers.get(peerId);
    if (slot) this.armEar(slot);
    return this.micPromise;
  }

  /** Voice only, one person. The mic promise must already have been started from a tap. */
  async beginVoice(peerId: string): Promise<"ok" | "no-mic" | "not-ready"> {
    const slot = this.peers.get(peerId);
    if (!slot || !this.linkUp(slot)) return "not-ready";
    this.armEar(slot);
    const mic = await (this.micPromise ?? this.primeVoice(peerId));
    if (mic !== "ok" || !this.mic) return "no-mic";
    const track = this.mic.getAudioTracks().find((item) => item.readyState === "live");
    if (!track) return "no-mic";
    try {
      if (this.voicePeer && this.voicePeer !== peerId) this.endVoice();
      this.voicePeer = peerId;
      track.enabled = true;
      const transceiver = this.voiceTransceiver(slot);
      if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
      await transceiver.sender.replaceTrack(track);
      slot.audioSender = transceiver.sender;
      if (slot.incoming) this.hear(slot, slot.incoming);
      return "ok";
    } catch {
      return "not-ready";
    }
  }

  endVoice() {
    const id = this.voicePeer;
    this.voicePeer = null;
    const slot = id ? this.peers.get(id) : undefined;
    if (slot?.audioSender) void slot.audioSender.replaceTrack(null).catch(() => undefined);
    this.mic?.getTracks().forEach((track) => track.stop());
    this.mic = null;
    this.micPromise = null;
    this.quiet(slot);
  }

  private linkUp(slot: PeerSlot): boolean {
    if (slot.reliable?.readyState === "open" || slot.state?.readyState === "open") return true;
    const ice = slot.pc.iceConnectionState;
    return slot.pc.connectionState === "connected" || ice === "connected" || ice === "completed";
  }

  private armEar(slot: PeerSlot) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      if (!this.voiceCtx) this.voiceCtx = new Ctx();
      void this.voiceCtx.resume().then(() => {
        if (slot.incoming) this.hear(slot, slot.incoming);
      }).catch(() => undefined);
    }
    if (!slot.playback && typeof Audio !== "undefined") {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      audio.volume = 1;
      audio.style.display = "none";
      document.body.appendChild(audio);
      slot.playback = audio;
      void audio.play().catch(() => undefined);
    }
  }

  private hear(slot: PeerSlot, stream: MediaStream) {
    slot.incoming = stream;
    const ctx = this.voiceCtx;
    if (ctx && ctx.state === "running") {
      void ctx.resume().catch(() => undefined);
      try {
        slot.voiceIn?.disconnect();
      } catch {
        /* already disconnected */
      }
      const src = ctx.createMediaStreamSource(stream);
      src.connect(ctx.destination);
      slot.voiceIn = src;
      if (slot.playback) slot.playback.srcObject = null;
      return;
    }
    const audio = slot.playback;
    if (!audio) return;
    if (audio.srcObject !== stream) audio.srcObject = stream;
    void audio.play().catch(() => undefined);
  }

  private quiet(slot?: PeerSlot) {
    if (!slot) return;
    try {
      slot.voiceIn?.disconnect();
    } catch {
      /* already disconnected */
    }
    slot.voiceIn = undefined;
    slot.incoming = undefined;
    if (slot.playback) {
      slot.playback.pause();
      slot.playback.srcObject = null;
    }
  }

  private voiceTransceiver(slot: PeerSlot): RTCRtpTransceiver {
    const list = slot.pc.getTransceivers();
    const owned = slot.audioSender ? list.find((t) => t.sender === slot.audioSender) : undefined;
    if (owned) return owned;
    const found = list.find((t) => t.receiver.track?.kind === "audio" || t.sender.track?.kind === "audio");
    if (found) return found;
    const created = slot.pc.addTransceiver("audio", { direction: "sendrecv" });
    slot.audioSender = created.sender;
    return created;
  }

  private async publishLocal(pc: RTCPeerConnection) {
    await pc.setLocalDescription();
  }

  peerList(): PeerInfo[] {
    return [...this.peers.values()].map((s) => ({ ...s.info }));
  }

  // ── signaling loop ─────────────────────────────────────────────────────────

  private schedulePoll(delay: number): void {
    if (this.closed) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private anyPairConnecting(): boolean {
    for (const s of this.peers.values()) {
      // Terminal pairs (NAT-blocked after all recovery attempts) must not pin
      // the session at the 400ms fast-poll rate.
      if (s.terminal) continue;
      if (s.info.connectionState !== "connected") return true;
    }
    return false;
  }

  private async pollOnce(): Promise<void> {
    const params = new URLSearchParams({
      room: this.opts.room,
      peer: this.opts.selfId,
      name: this.opts.name ?? "",
      since: String(this.cursor),
    });
    const res = await fetch(`${rtcBase()}?${params}`);
    if (this.closed) return;
    if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
    const body = (await res.json()) as RtcPollResponse;
    if (this.closed) return;
    if (!this.everPolled) {
      this.everPolled = true;
      this.opts.onConnected?.();
    }
    this.reconcileRoster(body.peers);
    const roster = new Set(body.peers.map((p) => p.id));
    for (const sig of body.signals) {
      this.cursor = Math.max(this.cursor, sig.id);
      await this.onSignal(sig.from, sig.kind, sig.payload, roster);
      if (this.closed) return;
    }
  }

  private async poll(): Promise<void> {
    if (this.closed) return;
    try {
      await this.pollOnce();
      this.misses = 0;
    } catch {
      this.misses += 1;
      if (!this.everPolled && this.misses >= 2) {
        this.everPolled = true;
        this.opts.onConnected?.();
      }
    }
    const delay = this.misses > 2 ? 5000 : this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS;
    this.schedulePoll(delay);
  }

  private reconcileRoster(peers: { id: string; name: string }[]): void {
    const alive = new Set(peers.map((p) => p.id));
    for (const p of peers) {
      if (p.id === this.opts.selfId) continue;
      const existing = this.peers.get(p.id);
      if (existing) {
        existing.info.name = p.name;
      } else {
        // Exactly one side dials each pair; the other waits for the offer.
        this.connectTo(p.id, p.name, this.opts.selfId > p.id);
      }
    }
    for (const [id, slot] of this.peers) {
      if (!alive.has(id)) {
        if (this.voicePeer === id) this.endVoice();
        slot.pc.close();
        this.peers.delete(id);
      }
    }
    this.emitPeers();
  }

  // ── per-pair connection ────────────────────────────────────────────────────

  private connectTo(peerId: string, name: string, initiator: boolean): PeerSlot | null {
    if (this.closed) return null;
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers ?? defaultIceServers(),
    });
    const slot: PeerSlot = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      lastProgressAt: Date.now(),
      recoveryAttempts: 0,
      info: {
        id: peerId,
        name,
        connectionState: pc.connectionState,
        candidateType: null,
        rttMs: null,
      },
    };
    this.peers.set(peerId, slot);

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.sendSignal(peerId, "ice", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      slot.info.connectionState = pc.connectionState;
      if (pc.connectionState === "connecting" || pc.connectionState === "connected") {
        slot.lastProgressAt = Date.now();
      }
      if (pc.connectionState === "connected") {
        slot.recoveryAttempts = 0;
        slot.terminal = false;
        void this.readCandidateType(slot);
      }
      this.emitPeers();
      if (pc.connectionState === "failed") {
        // Refires negotiationneeded → a fresh offer through signaling, so a
        // lost offer or dead path cannot wedge the pair (glare-safe).
        pc.restartIce();
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.schedulePoll(FAST_POLL_MS);
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await this.publishLocal(pc);
        await this.sendSignal(peerId, "offer", pc.localDescription!.toJSON());
      } catch {
        // A failed offer is retried on the next negotiationneeded.
      } finally {
        slot.makingOffer = false;
      }
    };
    pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
    pc.ontrack = (e) => {
      if (e.track.kind !== "audio") return;
      const stream = e.streams[0]?.getAudioTracks().length ? e.streams[0] : new MediaStream([e.track]);
      if (e.transceiver) slot.audioSender = e.transceiver.sender;
      const play = () => this.hear(slot, stream);
      e.track.onunmute = play;
      e.track.onended = () => this.quiet(slot);
      play();
    };

    if (initiator) {
      // An audio section from the start, so a later talk does not have to rebuild the room.
      slot.audioSender = pc.addTransceiver("audio", { direction: "sendrecv" }).sender;
      this.attachChannel(
        slot,
        pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }),
      );
      this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
    }
    return slot;
  }

  private attachChannel(slot: PeerSlot, channel: RTCDataChannel): void {
    if (channel.label === "state") slot.state = channel;
    else slot.reliable = channel;
    channel.onopen = () => {
      slot.lastProgressAt = Date.now();
      if (slot.info.connectionState !== "connected") {
        slot.info.connectionState = "connected";
        this.emitPeers();
      }
    };
    channel.onmessage = (e) => {
      let msg: { t: string; d?: unknown };
      try {
        msg = JSON.parse(e.data as string) as { t: string; d?: unknown };
      } catch {
        return;
      }
      if (msg.t === "ping") {
        if (slot.state?.readyState === "open") {
          slot.state.send(JSON.stringify({ t: "pong" }));
        }
      } else if (msg.t === "pong") {
        if (slot.pingSentAt) {
          slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
          slot.pingSentAt = undefined;
          this.emitPeers();
        }
      } else {
        this.opts.onMessage?.(
          slot.info.id,
          msg.d,
          channel.label === "state" ? "state" : "reliable",
        );
      }
    };
  }

  /** Apply buffered ICE candidates once a remote description is in place. */
  private async flushPendingCandidates(slot: PeerSlot): Promise<void> {
    while (slot.pendingCandidates.length > 0) {
      const candidate = slot.pendingCandidates.shift()!;
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch (err) {
        if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
      }
      if (this.closed) return;
    }
  }

  private async onSignal(
    from: string,
    kind: SignalKind,
    payload: unknown,
    roster: Set<string>,
  ): Promise<void> {
    if (this.closed) return;
    let slot = this.peers.get(from);
    if (!slot) {
      // New peers dial us in the same poll that adds them to the roster.
      // Signals outlive membership, so drop senders the roster doesn't vouch for.
      if (!roster.has(from)) return;
      const created = this.connectTo(from, "", false);
      if (!created) return;
      slot = created;
    }
    const polite = this.opts.selfId < from;

    try {
      if (kind === "offer" || kind === "answer") {
        const description = payload as RTCSessionDescriptionInit;
        const collision =
          kind === "offer" && (slot.makingOffer || slot.pc.signalingState !== "stable");
        slot.ignoreOffer = !polite && collision;
        if (slot.ignoreOffer) return;
        try {
          await slot.pc.setRemoteDescription(description); // implicit rollback when polite
        } catch (err) {
          // A pc resumed from suspend can be unable to take any new remote
          // offer (stale DTLS fingerprint). Rebuild the pair once and apply
          // the same offer to the fresh pc before giving up.
          if (kind !== "offer" || slot.recreatedForOffer) throw err;
          const attempts = slot.recoveryAttempts;
          const name = slot.info.name;
          slot.pc.close();
          this.peers.delete(from);
          const fresh = this.connectTo(from, name, false);
          if (!fresh) return;
          fresh.recoveryAttempts = attempts;
          fresh.recreatedForOffer = true;
          slot = fresh;
          await slot.pc.setRemoteDescription(description);
        }
        if (this.closed) return;
        await this.flushPendingCandidates(slot);
        if (this.closed) return;
        if (kind === "offer") {
          await this.publishLocal(slot.pc);
          if (this.closed) return;
          await this.sendSignal(from, "answer", slot.pc.localDescription!.toJSON());
        }
      } else if (kind === "ice") {
        const candidate = payload as RTCIceCandidateInit;
        if (!slot.pc.remoteDescription) {
          // Candidate raced ahead of its SDP — hold it until the description
          // lands (flushed after every successful setRemoteDescription).
          slot.pendingCandidates.push(candidate);
          return;
        }
        try {
          await slot.pc.addIceCandidate(candidate);
        } catch (err) {
          // The enclosing catch would swallow a rethrow; log the real signal.
          if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
        }
      }
    } catch {
      // Negotiation errors resolve on the next offer cycle; state is visible
      // to the app via connectionState.
    }
  }

  /**
   * Signals are serialized per remote peer (a candidate must never overtake
   * its SDP into the DB) and retried on failure with short backoff.
   */
  private sendSignal(to: string, kind: SignalKind, payload: unknown): Promise<void> {
    const prev = this.signalQueues.get(to) ?? Promise.resolve();
    const next = prev.then(() => this.postSignal(to, kind, payload));
    this.signalQueues.set(
      to,
      next.catch(() => {}),
    );
    return next;
  }

  private async postSignal(to: string, kind: SignalKind, payload: unknown): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.closed) return;
      try {
        const res = await fetch(rtcBase(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            op: "signal",
            room: this.opts.room,
            from: this.opts.selfId,
            to,
            kind,
            payload,
          }),
        });
        if (res.ok) return;
        throw new Error(`signal POST failed: ${res.status}`);
      } catch (err) {
        if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
          // Delivery gave up; the pair converges on the next offer cycle (or
          // the watchdog rebuilds it). Logged once so failures are visible.
          console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
          return;
        }
        await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  // ── diagnostics + recovery ─────────────────────────────────────────────────

  private pingAll(): void {
    const wire = JSON.stringify({ t: "ping" });
    for (const slot of this.peers.values()) {
      if (slot.state?.readyState !== "open") continue;
      const stale =
        slot.pingSentAt !== undefined && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
      if (slot.pingSentAt === undefined || stale) {
        // A lost pong must not freeze rttMs forever: expire and re-ping.
        slot.pingSentAt = performance.now();
        slot.state.send(wire);
      }
    }
  }

  /**
   * Stuck-pair recovery, piggybacked on the ping interval. A pair that has
   * made no progress for STALL_MS gets rebuilt by the dialer with a FRESH
   * RTCPeerConnection (new DTLS identity — fixes the suspend/resume
   * fingerprint wedge). After MAX_RECOVERY_ATTEMPTS the pair is terminal:
   * visible to the app as its last connectionState, ignored by fast-poll.
   */
  private watchdog(): void {
    if (this.closed) return;
    const now = Date.now();
    for (const [peerId, slot] of this.peers) {
      // pc.close() and some suspend/resume wedges never fire
      // connectionstatechange — read the LIVE state so a silently-dead pc
      // still trips the stall timer instead of hiding behind a cached
      // "connected". Only live progress states refresh the stall clock.
      const live = slot.pc.connectionState;
      if (live !== slot.info.connectionState) {
        slot.info.connectionState = live;
        if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
        this.emitPeers();
      }
      if (slot.terminal || live === "connected") continue;
      if (now - slot.lastProgressAt <= STALL_MS) continue;
      if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        slot.terminal = true;
        this.emitPeers();
        continue;
      }
      slot.recoveryAttempts += 1;
      slot.lastProgressAt = now; // re-arm the stall window
      if (this.opts.selfId > peerId) {
        // We are the dialer: rebuild the pair from scratch.
        const { name } = slot.info;
        const attempts = slot.recoveryAttempts;
        slot.pc.close();
        this.peers.delete(peerId);
        const fresh = this.connectTo(peerId, name, true);
        if (fresh) fresh.recoveryAttempts = attempts;
        this.schedulePoll(FAST_POLL_MS);
      }
      // Receiver side: count the stall window and wait for the dialer's
      // fresh offer (onSignal absorbs it, recreating our pc if needed).
    }
  }

  private async readCandidateType(slot: PeerSlot): Promise<void> {
    // relay = TURN (none configured by default); srflx/host = direct path.
    try {
      const stats = await slot.pc.getStats();
      let selected: RTCIceCandidatePairStats | undefined;
      stats.forEach((s) => {
        if (s.type === "candidate-pair" && (s as RTCIceCandidatePairStats).nominated) {
          selected = s as RTCIceCandidatePairStats;
        }
      });
      const localId = selected?.localCandidateId;
      if (localId) {
        const local = stats.get(localId) as { candidateType?: string } | undefined;
        slot.info.candidateType = local?.candidateType ?? null;
        this.emitPeers();
      }
    } catch {
      // getStats is best-effort diagnostics only.
    }
  }

  private emitPeers(): void {
    // Only notify when something observable actually changed — React state
    // setters otherwise re-render consumers on every poll/ping.
    const list = this.peerList();
    const fingerprint = JSON.stringify(
      list.map((p) => [p.id, p.name, p.connectionState, p.candidateType, p.rttMs]),
    );
    if (fingerprint === this.lastPeersFingerprint) return;
    this.lastPeersFingerprint = fingerprint;
    this.opts.onPeersChanged?.(list);
  }
}
