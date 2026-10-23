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
  /** A pose arrived through the room, even if the direct link is still down. */
  relayed?: boolean;
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
const STALL_MS = 25_000;

/** Public room relay. GitHub Pages is static, so the meadow calls this. */
export const PUBLIC_RTC_URL = "https://vibe-rtc.morning-myth-634.workers.dev/api/rtc";

export function rtcBase(): string {
  if (typeof location !== "undefined" && location.hostname.endsWith("github.io")) return PUBLIC_RTC_URL;
  return "/api/rtc";
}
const MAX_RECOVERY_ATTEMPTS = 6;
const SIGNAL_RETRY_DELAYS_MS = [250, 750];

export function defaultIceServers(): RTCIceServer[] {
  const urls = (import.meta.env.VITE_STUN_URLS as string | undefined)
    ?.split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const turn = relayCredential();
  return [
    {
      urls: urls?.length
        ? urls
        : ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:stun.relay.metered.ca:80"],
    },
    {
      urls: [
        "turn:staticauth.openrelay.metered.ca:80",
        "turn:staticauth.openrelay.metered.ca:443",
        "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
        "turns:staticauth.openrelay.metered.ca:443?transport=tcp",
      ],
      username: turn.username,
      credential: turn.credential,
    },
  ];
}

/** Time-limited username for the public relay. Secret is the published Open Relay static auth secret. */
function relayCredential() {
  const username = `${Math.floor(Date.now() / 1000) + 12 * 60 * 60}:vibe`;
  return { username, credential: hmacSha1Base64("openrelayprojectsecret", username) };
}

function hmacSha1Base64(key: string, message: string) {
  const block = 64;
  let keyBytes = utf8(key);
  if (keyBytes.length > block) keyBytes = sha1(keyBytes);
  const ipad = new Uint8Array(block);
  const opad = new Uint8Array(block);
  ipad.set(keyBytes);
  opad.set(keyBytes);
  for (let i = 0; i < block; i += 1) {
    ipad[i] ^= 0x36;
    opad[i] ^= 0x5c;
  }
  const inner = sha1(concat(ipad, utf8(message)));
  return bytesToBase64(sha1(concat(opad, inner)));
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function bytesToBase64(bytes: Uint8Array) {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

function sha1(bytes: Uint8Array) {
  const bitLength = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) & ~63));
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLength, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const digest = new DataView(out.buffer);
  digest.setUint32(0, h0, false);
  digest.setUint32(4, h1, false);
  digest.setUint32(8, h2, false);
  digest.setUint32(12, h3, false);
  digest.setUint32(16, h4, false);
  return out;
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
  private voiceEpoch = 0;
  private voiceCtx: AudioContext | null = null;
  private lastRelay = 0;
  private muted = false;

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
    this.relayPose(data);
  }

  /** Positions go through the room too, so a blocked direct link still shows the person. */
  private relayPose(data: unknown) {
    const pose = data as { k?: string };
    if (pose?.k !== "pose") return;
    const need = [...this.peers.entries()].filter(([, slot]) => slot.state?.readyState !== "open").map(([id]) => id);
    if (!need.length) return;
    const now = Date.now();
    if (now - this.lastRelay < 450) return;
    this.lastRelay = now;
    const payload = { vibe: "pose", ...pose };
    for (const id of need) void this.sendSignal(id, "ice", payload);
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

  setMuted(on: boolean) {
    this.muted = on;
    this.mic?.getAudioTracks().forEach((track) => {
      track.enabled = !on;
    });
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

  /** Voice only. Waits through a slow microphone prompt, then keeps trying the path. */
  async beginVoice(peerId: string): Promise<"ok" | "no-mic" | "not-ready" | "cancelled"> {
    const epoch = this.voiceEpoch;
    const slotNow = this.peers.get(peerId);
    if (slotNow) this.armEar(slotNow);
    const mic = await (this.micPromise ?? this.primeVoice(peerId));
    if (this.voiceEpoch !== epoch || this.closed) return "cancelled";
    if (mic !== "ok" || !this.mic) return "no-mic";
    const deadline = Date.now() + 90_000;
    let slot = this.peers.get(peerId);
    while ((!slot || !this.linkUp(slot)) && Date.now() < deadline) {
      if (this.voiceEpoch !== epoch || this.closed) return "cancelled";
      await new Promise((resolve) => setTimeout(resolve, 500));
      slot = this.peers.get(peerId);
      if (slot) this.armEar(slot);
    }
    if (this.voiceEpoch !== epoch || this.closed) return "cancelled";
    if (!slot || !this.linkUp(slot)) return "not-ready";
    const track = this.mic.getAudioTracks().find((item) => item.readyState === "live");
    if (!track) return "no-mic";
    try {
      this.voicePeer = peerId;
      track.enabled = !this.muted;
      const transceiver = this.voiceTransceiver(slot);
      if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
      await transceiver.sender.replaceTrack(track);
      if (this.voiceEpoch !== epoch) return "cancelled";
      slot.audioSender = transceiver.sender;
      if (slot.incoming) this.hear(slot, slot.incoming);
      return "ok";
    } catch {
      return "not-ready";
    }
  }

  endVoice() {
    this.voiceEpoch += 1;
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
      slot.lastProgressAt = Date.now();
      if (e.candidate) void this.sendSignal(peerId, "ice", e.candidate.toJSON());
    };
    pc.oniceconnectionstatechange = () => {
      const ice = pc.iceConnectionState;
      if (ice === "checking" || ice === "connected" || ice === "completed") {
        slot.lastProgressAt = Date.now();
        slot.terminal = false;
      }
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
        const marked = payload as { vibe?: string };
        if (marked?.vibe === "pose") {
          slot.info.relayed = true;
          this.emitPeers();
          this.opts.onMessage?.(from, payload, "state");
          return;
        }
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
      const ice = slot.pc.iceConnectionState;
      if (ice === "checking" || ice === "connected" || ice === "completed") {
        slot.lastProgressAt = now;
        continue;
      }
      if (now - slot.lastProgressAt <= STALL_MS) continue;
      if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
        slot.terminal = true;
        slot.info.connectionState = "failed";
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
      list.map((p) => [p.id, p.name, p.connectionState, p.candidateType, p.rttMs, p.relayed]),
    );
    if (fingerprint === this.lastPeersFingerprint) return;
    this.lastPeersFingerprint = fingerprint;
    this.opts.onPeersChanged?.(list);
  }
}
