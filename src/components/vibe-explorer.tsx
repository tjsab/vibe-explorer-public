import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  Eye,
  EyeOff,
  Flower2,
  Gift,
  Link,
  Music,
  Phone,
  Send,
  Sprout,
  Utensils,
  X,
} from "lucide-react";
import { useP2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { VillageWorld, asAnon, isPose, type CropSnap, type PoseMsg, type Status, type WorldHooks } from "@/game/world";

const CLOTHES = [0xb85c38, 0x3d7ea6, 0x3e8f6e, 0xc45c4a, 0x6b5b95, 0xc47b4a, 0x4a6670, 0x8c4a3a];

type Talk = { name: string; line: string };
type Reliable =
  | { k: "chat"; text: string; n: string }
  | { k: "harvest"; id: number; until: number }
  | { k: "hi"; n: string }
  | { k: "offer"; n: string }
  | { k: "snapshot"; crops: CropSnap[]; stock?: number; milk?: number; eggs?: number; scores?: { n: string; p: number }[] }
  | { k: "give"; n: string; qty?: number; greens?: number; milk?: number; eggs?: number }
  | { k: "take"; n: string; good?: "greens" | "milk" | "eggs" }
  | { k: "score"; n: string; p: number }
  | { k: "feed"; text: string }
  | { k: "call"; n: string }
  | { k: "call-yes"; n: string }
  | { k: "call-no" }
  | { k: "call-fail"; why?: string }
  | { k: "call-end" };

type FeedItem = { id: number; text: string };
type CallState = { id: string; name: string; phase: "in" | "out" | "live" };

function readRoom() {
  const raw = new URLSearchParams(window.location.search).get("room") ?? "village";
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toLowerCase();
  return clean || "village";
}

function readName(room: string) {
  const key = `vibe-name:${room}`;
  const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 24) ?? "";
  try {
    const saved = clean(localStorage.getItem(key));
    if (saved) return saved;
  } catch {
    /* private mode */
  }
  let migrated = "";
  try {
    migrated = clean(sessionStorage.getItem("vibe-name"));
    sessionStorage.removeItem("vibe-name");
  } catch {
    /* private mode */
  }
  if (!migrated) {
    try {
      const raw = localStorage.getItem(`vibe-room:${room}`);
      if (raw) migrated = clean((JSON.parse(raw) as { name?: string }).name);
    } catch {
      /* old save */
    }
  }
  const name = migrated || `Anon ${Math.floor(1000 + Math.random() * 9000)}`;
  try {
    localStorage.setItem(key, name);
  } catch {
    /* private mode */
  }
  return name;
}

function storeName(room: string, name: string) {
  try {
    localStorage.setItem(`vibe-name:${room}`, name);
  } catch {
    /* private mode */
  }
}

function readClean() {
  try {
    return localStorage.getItem("vibe-clean") === "1";
  } catch {
    return false;
  }
}

function readTopHidden() {
  try {
    return localStorage.getItem("vibe-top") === "0";
  } catch {
    return false;
  }
}

function readColor() {
  try {
    const saved = Number(localStorage.getItem("vibe-color") ?? "");
    if (Number.isInteger(saved) && saved >= 0 && saved < CLOTHES.length) return CLOTHES[saved];
  } catch {
    /* private mode */
  }
  const i = Math.floor(Math.random() * CLOTHES.length);
  try {
    localStorage.setItem("vibe-color", String(i));
  } catch {
    /* private mode */
  }
  return CLOTHES[i];
}

function voiceLine(why: string | undefined, who: "you" | "them") {
  if (why === "no-mic") {
    return who === "you"
      ? "Your microphone is blocked. Allow it for this page, then tap Talk."
      : "Their microphone is blocked. They can allow it and try again.";
  }
  if (why === "not-ready") return "You can see each other, but voice isn't open yet. Stand close and tap Talk again.";
  return "The voice path didn't open. Tap Talk again.";
}

function presenceLine(joined: boolean, peers: PeerInfo[]) {
  if (!joined) return "Opening a shared path…";
  const label = (p: PeerInfo) => asAnon(p.name || "", p.id);
  const here = peers.filter((p) => p.connectionState === "connected" || p.relayed);
  const failed = peers.filter((p) => p.connectionState === "failed" || p.connectionState === "closed");
  if (peers.length === 0) return "Just you and the villagers.";
  if (here.length === 0 && failed.length === peers.length) return "Someone is in the room, but voice may be blocked.";
  if (here.length === 0) return `${peers.map(label).join(", ")} is on the way.`;
  return `Here: ${here.map(label).join(", ")}`;
}

function Village({
  room,
  name,
  color,
  onRename,
  onRoom,
}: {
  room: string;
  name: string;
  color: number;
  onRename: (name: string) => void;
  onRoom: (room: string) => void;
}) {
  const p2p = useP2PRoom({ room, name });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<VillageWorld | null>(null);
  const hooks = useRef<WorldHooks>({
    onTalk: () => undefined,
    onToast: () => undefined,
    onStatus: () => undefined,
    onHarvest: () => undefined,
    onFeed: () => undefined,
  });
  const [toast, setToast] = useState("Welcome to the meadow.");
  const [talk, setTalk] = useState<Talk | null>(null);
  const [status, setStatus] = useState<Status>({
    food: 0,
    milk: 0,
    eggs: 0,
    market: 0,
    stallMilk: 0,
    stallEggs: 0,
    service: 0,
    ready: 0,
    rank: "Neighbor",
    nextCost: 8,
    nextName: "Helper",
    nextGift: "Your basket holds more.",
    devoted: 0,
    devotionNeed: 90,
    singing: false,
    sitting: false,
    quiet: false,
    nearby: "",
    tasks: [],
  });
  const [sheet, setSheet] = useState<null | "tasks" | "practice">(null);
  const [group, setGroup] = useState<"do" | "be" | "give">("do");
  const [chat, setChat] = useState("");
  const [roomDraft, setRoomDraft] = useState(room);
  const [copied, setCopied] = useState(false);
  const [clean, setClean] = useState(readClean);
  const [topHidden, setTopHidden] = useState(readTopHidden);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [call, setCall] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const feedId = useRef(1);
  const seen = useRef(new Set<string>());
  const joyRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);

  hooks.current.onTalk = (who, line) => setTalk({ name: who, line });
  hooks.current.onToast = (msg) => setToast(msg);
  hooks.current.onStatus = (next) => setStatus(next);
  hooks.current.onHarvest = (id, until) => p2p.send({ k: "harvest", id, until });
  hooks.current.onFeed = (line, share) => {
    pushFeed(line);
    if (share) p2p.send({ k: "feed", text: line });
  };
  hooks.current.onGreet = (id) => {
    p2p.send({ k: "hi", n: name }, id);
  };
  hooks.current.onMarket = (msg) => {
    if (msg.op === "give") p2p.send({ k: "give", n: name, qty: msg.greens, greens: msg.greens, milk: msg.milk, eggs: msg.eggs });
    else if (msg.op === "take") p2p.send({ k: "take", n: name, good: msg.good });
    else p2p.send({ k: "score", n: name, p: msg.p });
  };

  function pushFeed(text: string) {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (!clean) return;
    setFeed((prev) => {
      if (prev[0]?.text === clean) return prev;
      return [{ id: feedId.current++, text: clean }, ...prev].slice(0, 8);
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = new VillageWorld(canvas, hooks.current, { name, color, room });
    worldRef.current = world;
    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, [color, room]);

  useEffect(() => {
    worldRef.current?.setName(name);
    p2p.setName(name);
  }, [name, p2p.setName]);

  useEffect(() => {
    return p2p.onMessage(async (from, data, channel) => {
      const world = worldRef.current;
      if (!world || !data || typeof data !== "object") return;
      const msg = data as Reliable | PoseMsg;
      if (channel === "state" && isPose(msg)) {
        world.upsertRemote(from, msg);
        return;
      }
      if (channel !== "reliable" || !("k" in msg)) return;
      if (msg.k === "chat" && typeof msg.text === "string") {
        world.setRemoteChat(from, msg.text.slice(0, 80));
      } else if (msg.k === "harvest" && typeof msg.id === "number" && typeof msg.until === "number") {
        world.applyHarvest(msg.id, msg.until);
      } else if (msg.k === "snapshot" && Array.isArray(msg.crops)) {
        world.applySnapshot(msg.crops);
        if (typeof msg.stock === "number" && Array.isArray(msg.scores)) {
          world.applyMarketSnapshot(msg.stock, msg.scores, { milk: msg.milk, eggs: msg.eggs });
        }
      } else if (msg.k === "give" && typeof msg.n === "string") {
        world.receiveGive(msg.n, msg.greens ?? msg.qty ?? 0, msg.milk ?? 0, msg.eggs ?? 0);
      } else if (msg.k === "take" && typeof msg.n === "string") {
        world.receiveTake(msg.n, msg.good ?? "greens");
      } else if (msg.k === "score" && typeof msg.n === "string" && typeof msg.p === "number") {
        world.receiveScore(msg.n, msg.p);
      } else if (msg.k === "feed" && typeof msg.text === "string") {
        pushFeed(msg.text);
      } else if (msg.k === "hi" && typeof msg.n === "string") {
        world.pulseHello(from);
        setToast(`${asAnon(msg.n, from)} waves hello.`);
      } else if (msg.k === "offer" && typeof msg.n === "string") {
        world.receiveFood(asAnon(msg.n, from));
      } else if (msg.k === "call" && typeof msg.n === "string") {
        const who = asAnon(msg.n, from);
        setCall({ id: from, name: who, phase: "in" });
        setToast(`${who} wants to talk.`);
      } else if (msg.k === "call-yes") {
        setToast("Waiting for the microphone…");
        const result = await p2p.beginVoice(from);
        if (result === "cancelled") return;
        if (result !== "ok") {
          p2p.send({ k: "call-fail", why: result }, from);
          p2p.endVoice();
          setCall(null);
          setToast(voiceLine(result, "you"));
          return;
        }
        world.setTalking(from, true);
        world.setSelfTalking(true);
        setCall((prev) => ({ id: from, name: prev?.name ?? "Someone", phase: "live" }));
        setToast("You're talking. Voice only.");
      } else if (msg.k === "call-no") {
        p2p.endVoice();
        setCall(null);
        setToast("Not just now.");
      } else if (msg.k === "call-fail") {
        p2p.endVoice();
        setCall(null);
        setToast(voiceLine(msg.why, msg.why === "no-mic" ? "them" : "you"));
      } else if (msg.k === "call-end") {
        p2p.endVoice();
        worldRef.current?.setTalking(from, false);
        worldRef.current?.setSelfTalking(false);
        setCall(null);
        setToast("The talk rests.");
      }
    });
  }, [p2p, name]);

  const goneAt = useRef(0);
  useEffect(() => {
    if (!call) {
      goneAt.current = 0;
      return;
    }
    const here = p2p.peers.some((peer) => peer.id === call.id);
    if (here) {
      goneAt.current = 0;
      return;
    }
    if (!goneAt.current) goneAt.current = Date.now();
    const left = 45000 - (Date.now() - goneAt.current);
    const timer = window.setTimeout(() => {
      if (p2p.peers.some((peer) => peer.id === call.id)) return;
      p2p.endVoice();
      worldRef.current?.setTalking(call.id, false);
      worldRef.current?.setSelfTalking(false);
      setCall((current) => (current?.id === call.id ? null : current));
      setToast("The talk dropped.");
    }, Math.max(1000, left));
    return () => window.clearTimeout(timer);
  }, [call, p2p]);

  useEffect(() => {
    if (call?.phase !== "out") return;
    const id = call.id;
    const timer = window.setTimeout(() => {
      setCall((current) => {
        if (!current || current.id !== id || current.phase !== "out") return current;
        p2p.send({ k: "call-end" }, id);
        p2p.endVoice();
        setToast("No answer. The talk can wait.");
        return null;
      });
    }, 28000);
    return () => window.clearTimeout(timer);
  }, [call, p2p]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      const world = worldRef.current;
      if (world && now - last >= 50) {
        p2p.broadcast(world.getPose());
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [p2p.broadcast]);

  useEffect(() => {
    const world = worldRef.current;
    const roster = p2p.peers.map((p) => p.id);
    const connected = p2p.peers.filter((p) => p.connectionState === "connected").map((p) => p.id);
    const connectedSet = new Set(connected);
    for (const id of connected) {
      if (seen.current.has(id)) continue;
      const already = [p2p.selfId, ...connected.filter((x) => x !== id && seen.current.has(x))];
      const smallest = already.reduce((a, b) => (a < b ? a : b));
      if (smallest === p2p.selfId && world) {
        p2p.send({ k: "snapshot", crops: world.getCropSnapshot(), ...world.getMarketSnapshot() }, id);
      }
      seen.current.add(id);
    }
    for (const id of [...seen.current]) {
      if (!connectedSet.has(id)) seen.current.delete(id);
    }
    world?.retainRemotes(new Set(roster));
    const ids = [p2p.selfId, ...roster];
    world?.setDuty(ids.reduce((a, b) => (a < b ? a : b)) === p2p.selfId);
  }, [p2p.peers, p2p.selfId, p2p.send]);

  useEffect(() => {
    const el = joyRef.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    let active = false;
    let pointer = -1;
    const update = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const max = rect.width * 0.36;
      let dx = e.clientX - (rect.left + rect.width / 2);
      let dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.min(Math.hypot(dx, dy), max) || 0;
      const ang = Math.atan2(dy, dx);
      dx = Math.cos(ang) * dist;
      dy = Math.sin(ang) * dist;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      worldRef.current?.setJoy(dx / max, -dy / max);
    };
    const down = (e: PointerEvent) => {
      worldRef.current?.unlockAudio();
      active = true;
      pointer = e.pointerId;
      el.classList.add("is-pressed");
      el.setPointerCapture(e.pointerId);
      update(e);
    };
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointer) return;
      update(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      active = false;
      el.classList.remove("is-pressed");
      knob.style.transform = "translate(0px, 0px)";
      worldRef.current?.setJoy(0, 0);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, []);

  useEffect(() => {
    let dragging = false;
    let pointer = -1;
    let lx = 0;
    let ly = 0;
    const blocked = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el?.closest?.("button, input, textarea, a, summary, .vibe-joy, .vibe-hud, .vibe-dock, .vibe-peek, .vibe-topback");
    };
    const down = (e: PointerEvent) => {
      worldRef.current?.unlockAudio();
      if (e.button !== 0 || blocked(e.target)) return;
      dragging = true;
      pointer = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      worldRef.current?.beginLook();
    };
    const move = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointer) return;
      worldRef.current?.orbit(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      dragging = false;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code !== "KeyH" || e.metaKey || e.ctrlKey || e.altKey) return;
      setClean((value) => {
        const next = !value;
        try {
          localStorage.setItem("vibe-clean", next ? "1" : "0");
        } catch {
          /* private mode */
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleClean = () => {
    setClean((value) => {
      const next = !value;
      try {
        localStorage.setItem("vibe-clean", next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  const hangUp = () => {
    if (!call || call.phase === "in") return;
    p2p.send({ k: "call-end" }, call.id);
    p2p.endVoice();
    p2p.setMuted(false);
    setMuted(false);
    worldRef.current?.setTalking(call.id, false);
    worldRef.current?.setSelfTalking(false);
    worldRef.current?.announce(`${name} lets the talk rest.`);
    setCall(null);
    setToast("The talk rests.");
  };

  const startTalk = () => {
    const near = worldRef.current?.nearestRemote(4.6);
    if (!near) {
      setToast("Walk closer. Talk only reaches someone beside you.");
      return;
    }
    const ready = p2p.peers.some((p) => p.id === near.id && (p.connectionState === "connected" || p.connectionState === "connecting" || p.relayed));
    if (!ready) {
      setToast(`${near.name} is still on the way.`);
      return;
    }
    const priming = p2p.primeVoice(near.id);
    p2p.send({ k: "call", n: name }, near.id);
    setCall({ id: near.id, name: near.name, phase: "out" });
    setToast(`Asking ${near.name} to talk…`);
    void priming.then((mic) => {
      if (mic === "ok") return;
      setCall((current) => {
        if (!current || current.id !== near.id || current.phase === "live") return current;
        p2p.send({ k: "call-fail", why: "no-mic" }, near.id);
        p2p.endVoice();
        setToast(voiceLine("no-mic", "you"));
        return null;
      });
    });
  };

  const toggleTop = () => {
    setTopHidden((value) => {
      const next = !value;
      try {
        localStorage.setItem("vibe-top", next ? "0" : "1");
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("v");
    if (room === "village") url.searchParams.delete("room");
    else url.searchParams.set("room", room);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setToast("Link copied. Anyone who opens it joins this meadow.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setToast(`Share this page. Room code: ${room}`);
    }
  };

  const commitRoom = (value: string) => {
    const clean = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24).toLowerCase() || "village";
    setRoomDraft(clean);
    if (clean !== room) onRoom(clean);
  };

  return (
    <div className="vibe-stage" data-clean={clean ? "true" : "false"} data-top={topHidden ? "off" : "on"}>
      <canvas ref={canvasRef} className="vibe-canvas" />
      <button
        type="button"
        className="vibe-peek"
        aria-pressed={clean}
        aria-keyshortcuts="H"
        aria-label={clean ? "Show controls" : "Hide controls for a clear view"}
        onClick={toggleClean}
      >
        {clean ? <Eye className="size-5" aria-hidden="true" /> : <EyeOff className="size-5" aria-hidden="true" />}
        {clean ? null : <span>Hide</span>}
      </button>
      <div className="vibe-topcol">
        {topHidden ? (
          <button type="button" className="vibe-topback" onClick={toggleTop}>
            {p2p.joined ? "Live" : "…"} · {room}
          </button>
        ) : (
        <header className="vibe-hud vibe-glass">
          <div className="vibe-bar">
            <input
              className="vibe-name"
              aria-label="Your name"
              defaultValue={name}
              maxLength={24}
              onBlur={(e) => onRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="vibe-code">{p2p.joined ? "Live" : "…"} · {room}</span>
            <button type="button" className="vibe-iconbtn vibe-mini" onClick={() => void copyLink()} aria-label={copied ? "Copied" : "Copy invite link"}>
              <Link className="size-3.5" aria-hidden="true" />
            </button>
            <button type="button" className="vibe-caret" onClick={toggleTop} aria-label="Fold the room box">
              ^
            </button>
          </div>
          {p2p.peers.length > 0 ? <p className="vibe-presence">{presenceLine(p2p.joined, p2p.peers)}</p> : null}
          <details className="vibe-more">
            <summary>Room</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitRoom(roomDraft);
              }}
            >
              <input
                className="vibe-field"
                aria-label="Room code"
                value={roomDraft}
                onChange={(e) => setRoomDraft(e.target.value)}
                maxLength={24}
              />
              <button type="submit" className="vibe-iconbtn vibe-mini">
                Join
              </button>
            </form>
          </details>
        </header>
        )}
      </div>

      <div className="vibe-dock">
        {talk ? (
          <article className="vibe-talk vibe-glass">
            <button type="button" className="vibe-talk-x" onClick={() => setTalk(null)} aria-label="Close">
              <X className="size-4" />
            </button>
            <strong>{talk.name}</strong>
            <p>{talk.line}</p>
          </article>
        ) : toast ? (
          <p className="vibe-note vibe-glass">{toast}</p>
        ) : status.nearby ? (
          <p className="vibe-note vibe-glass">{status.nearby}</p>
        ) : feed[0] ? (
          <p className="vibe-note vibe-glass">{feed[0].text}</p>
        ) : (
          <p className="vibe-note vibe-glass keys-hint">WASD to walk. Tap a person to wave.</p>
        )}
        {call?.phase === "in" ? (
          <article className="vibe-talk vibe-glass">
            <strong>{call.name}</strong>
            <p>Wants to talk. Allow the microphone when the phone asks. This will wait.</p>
            <div className="vibe-callrow">
              <button
                type="button"
                className="vibe-btn"
                onClick={() => {
                  const priming = p2p.primeVoice(call.id);
                  setToast("Allow the microphone. This stays open.");
                  void (async () => {
                    const mic = await priming;
                    if (mic !== "ok") {
                      p2p.send({ k: "call-fail", why: "no-mic" }, call.id);
                      setCall(null);
                      setToast(voiceLine("no-mic", "you"));
                      return;
                    }
                    setToast("Microphone is on. Connecting the voice…");
                    const result = await p2p.beginVoice(call.id);
                    if (result === "cancelled") return;
                    if (result !== "ok") {
                      p2p.send({ k: "call-fail", why: result }, call.id);
                      p2p.endVoice();
                      setCall(null);
                      setToast(voiceLine(result, "you"));
                      return;
                    }
                    p2p.send({ k: "call-yes", n: name }, call.id);
                    worldRef.current?.setTalking(call.id, true);
                    worldRef.current?.setSelfTalking(true);
                    worldRef.current?.announce(`${name} and ${call.name} are talking.`);
                    setCall({ ...call, phase: "live" });
                    setToast("You're talking. Voice only.");
                  })();
                }}
              >
                Listen
              </button>
              <button
                type="button"
                className="vibe-btn"
                onClick={() => {
                  p2p.send({ k: "call-no" }, call.id);
                  setCall(null);
                  setToast("You let it pass.");
                }}
              >
                Not now
              </button>
            </div>
          </article>
        ) : null}
        {sheet === "tasks" ? (
          <section className="vibe-sheet vibe-glass" aria-label="Tasks">
            <header className="vibe-sheet-head">
              <strong>Tasks</strong>
              <button type="button" className="vibe-talk-x" onClick={() => setSheet(null)} aria-label="Close tasks">
                <X className="size-4" />
              </button>
            </header>
            {status.tasks.map((task) => (
              <article key={task.id} className="vibe-task" data-state={task.state}>
                <div className="vibe-task-top">
                  <strong>{task.title}</strong>
                  <span>{task.reward > 0 ? `+${task.reward}` : ""}</span>
                </div>
                <p>{task.detail}</p>
                <div className="vibe-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round(task.progress * 100)}%` }} />
                </div>
                <em>{task.state === "done" ? "Resting" : task.state === "doing" ? "In progress" : "Open"}</em>
              </article>
            ))}
          </section>
        ) : null}
        {sheet === "practice" ? (
          <section className="vibe-sheet vibe-glass" aria-label="Practice">
            <header className="vibe-sheet-head">
              <strong>{status.rank}</strong>
              <button type="button" className="vibe-talk-x" onClick={() => setSheet(null)} aria-label="Close practice">
                <X className="size-4" />
              </button>
            </header>
            <p>Service done {status.service}. Ready to use {status.ready}.</p>
            <p>
              Dome time {Math.floor(status.devoted / 60)}:{String(status.devoted % 60).padStart(2, "0")}.
              {status.devotionNeed > 0
                ? ` The next rise still wants ${Math.floor(status.devotionNeed / 60)}:${String(status.devotionNeed % 60).padStart(2, "0")} of quiet there.`
                : " The dome has given enough time for this step."}
            </p>
            {status.nextCost > 0 ? (
              <p>
                Next is {status.nextName}, for {status.nextCost}. {status.nextGift}
              </p>
            ) : (
              <p>{status.nextGift}</p>
            )}
            <button type="button" className="vibe-btn" data-on={status.nextCost > 0 && status.ready >= status.nextCost} onClick={() => worldRef.current?.rise()}>
              {status.rank === "Guide" ? "Call the table" : "Rise"}
            </button>
          </section>
        ) : null}
        {(call?.phase === "live" || call?.phase === "out") ? (
          <div className="vibe-live vibe-glass">
            <strong>{call.phase === "live" ? `Talking with ${call.name}` : `Asking ${call.name}…`}</strong>
            {call.phase === "live" ? (
              <button
                type="button"
                className="vibe-btn"
                data-on={muted}
                onClick={() => {
                  const next = !muted;
                  setMuted(next);
                  p2p.setMuted(next);
                }}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
            ) : null}
            <button type="button" className="vibe-btn" onClick={hangUp}>
              {call.phase === "live" ? "Hang up" : "Cancel"}
            </button>
          </div>
        ) : null}
        <div className="vibe-groups" role="tablist">
          <button type="button" className="vibe-btn" data-on={group === "do"} onClick={() => setGroup("do")}>Do</button>
          <button type="button" className="vibe-btn" data-on={group === "be"} onClick={() => setGroup("be")}>Be</button>
          <button type="button" className="vibe-btn" data-on={group === "give"} onClick={() => setGroup("give")}>Give</button>
          <button type="button" className="vibe-btn" data-on={sheet === "tasks"} onClick={() => setSheet((open) => (open === "tasks" ? null : "tasks"))}>Tasks</button>
          <button type="button" className="vibe-btn" data-on={sheet === "practice"} onClick={() => setSheet((open) => (open === "practice" ? null : "practice"))}>{status.rank}</button>
        </div>
        <div className="vibe-actions">
          {group === "do" ? (
            <>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.doHarvest()}>
                <Sprout className="size-4" aria-hidden="true" /> Pick · {status.food}
              </button>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.doMilk()}>
                Milk · {status.milk}
              </button>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.doEggs()}>
                Eggs · {status.eggs}
              </button>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.doEat()}>
                <Utensils className="size-4" aria-hidden="true" /> Eat
              </button>
            </>
          ) : null}
          {group === "be" ? (
            <>
              <button type="button" className="vibe-btn" data-on={status.singing} aria-pressed={status.singing} onClick={() => worldRef.current?.doSing()}>
                <Music className="size-4" aria-hidden="true" /> Sing
              </button>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.doDance()}>
                <Flower2 className="size-4" aria-hidden="true" /> Dance
              </button>
              <button type="button" className="vibe-btn" data-on={status.quiet} aria-pressed={status.quiet} onClick={() => worldRef.current?.doQuiet()}>
                Quiet
              </button>
              <button type="button" className="vibe-btn" data-on={status.sitting} aria-pressed={status.sitting} onClick={() => worldRef.current?.doSit()}>
                <Armchair className="size-4" aria-hidden="true" /> Sit
              </button>
              {!call && worldRef.current?.nearestRemote(4.6) ? (
                <button type="button" className="vibe-btn" onClick={startTalk}>
                  <Phone className="size-4" aria-hidden="true" /> Talk
                </button>
              ) : null}
            </>
          ) : null}
          {group === "give" ? (
            <>
              <button type="button" className="vibe-btn" onClick={() => {
                const near = worldRef.current?.tryOffer();
                if (near) p2p.send({ k: "offer", n: name }, near.id);
              }}>
                <Gift className="size-4" aria-hidden="true" /> Share
              </button>
              <button type="button" className="vibe-btn" onClick={() => worldRef.current?.leaveBasket()}>
                <Gift className="size-4" aria-hidden="true" /> Stall · {status.market}/{status.stallMilk}/{status.stallEggs}
              </button>
            </>
          ) : null}
        </div>
        <form
          className="vibe-chat"
          onSubmit={(e) => {
            e.preventDefault();
            const text = chat.trim().slice(0, 80);
            if (!text) return;
            worldRef.current?.say(text);
            p2p.send({ k: "chat", text, n: name });
            setChat("");
          }}
        >
          <input
            className="vibe-field"
            aria-label="Say something"
            placeholder="Say something"
            value={chat}
            maxLength={80}
            onChange={(e) => setChat(e.target.value)}
          />
          <button type="submit" className="vibe-iconbtn" aria-label="Send">
            <Send className="size-4" />
          </button>
        </form>
      </div>

      <div className="vibe-joy" ref={joyRef} aria-hidden="true">
        <div className="vibe-knob" ref={knobRef} />
      </div>
    </div>
  );
}

export function VibeExplorer() {
  const [ready, setReady] = useState(false);
  const [room, setRoom] = useState("village");
  const [name, setName] = useState("Friend");
  const [color, setColor] = useState(CLOTHES[0]);

  useEffect(() => {
    const nextRoom = readRoom();
    setRoom(nextRoom);
    setName(readName(nextRoom));
    setColor(readColor());
    const url = new URL(window.location.href);
    if (url.searchParams.has("v")) {
      url.searchParams.delete("v");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setReady(true);
  }, []);

  const commitRoom = (next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("v");
    if (next === "village") url.searchParams.delete("room");
    else url.searchParams.set("room", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setRoom(next);
    setName(readName(next));
  };

  const commitName = (next: string) => {
    const clean = next.replace(/\s+/g, " ").trim().slice(0, 24);
    if (!clean || clean === name) return;
    storeName(room, clean);
    setName(clean);
  };

  return (
    <main className="vibe-root">
      {ready ? (
        <Village
          key={room}
          room={room}
          name={name}
          color={color}
          onRename={commitName}
          onRoom={commitRoom}
        />
      ) : (
        <div className="vibe-boot">Opening the meadow…</div>
      )}
    </main>
  );
}
