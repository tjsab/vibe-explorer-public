import { DurableObject } from "cloudflare:workers";

/**
 * Room signaling for Vibe Explorer.
 * Hosted PartyKit stopped taking deploys on 16 Oct 2026, so this is the same
 * idea on Cloudflare: one Durable Object per room, HTTP poll in, WebRTC after.
 * The browser still speaks the existing /api/rtc contract.
 */

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const PEER_TTL_MS = 30_000;
const SIGNAL_TTL_MS = 60_000;
const MAX_PEERS = 12;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export class RtcRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS peers (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           seen INTEGER NOT NULL
         )`,
      );
      this.ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS signals (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           to_peer TEXT NOT NULL,
           from_peer TEXT NOT NULL,
           kind TEXT NOT NULL,
           payload TEXT NOT NULL,
           created INTEGER NOT NULL
         )`,
      );
    });
  }

  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET") return this.onGet(new URL(request.url));
    if (request.method === "POST") return this.onPost(request);
    return json({ error: "method not allowed" }, 405);
  }

  prune(now) {
    this.ctx.storage.sql.exec(`DELETE FROM peers WHERE seen < ?`, now - PEER_TTL_MS);
    this.ctx.storage.sql.exec(`DELETE FROM signals WHERE created < ?`, now - SIGNAL_TTL_MS);
    const extra = this.ctx.storage.sql
      .exec(`SELECT id FROM peers ORDER BY seen DESC LIMIT -1 OFFSET ?`, MAX_PEERS)
      .toArray();
    for (const row of extra) {
      this.ctx.storage.sql.exec(`DELETE FROM peers WHERE id = ?`, row.id);
    }
  }

  roster() {
    return this.ctx.storage.sql
      .exec(`SELECT id, name FROM peers ORDER BY id LIMIT ?`, MAX_PEERS)
      .toArray()
      .map((row) => ({ id: String(row.id), name: String(row.name).slice(0, 24) }));
  }

  onGet(url) {
    const room = url.searchParams.get("room") ?? "";
    const peer = url.searchParams.get("peer") ?? "";
    const name = (url.searchParams.get("name") ?? "").slice(0, 64);
    const since = Number(url.searchParams.get("since") ?? "0");
    if (!ID.test(room) || !ID.test(peer) || !Number.isFinite(since) || since < 0) {
      return json({ error: "invalid query" }, 400);
    }
    const now = Date.now();
    this.prune(now);
    this.ctx.storage.sql.exec(
      `INSERT INTO peers (id, name, seen) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, seen = excluded.seen`,
      peer,
      name,
      now,
    );
    const signals = this.ctx.storage.sql
      .exec(
        `SELECT id, from_peer, kind, payload FROM signals
         WHERE to_peer = ? AND id > ?
         ORDER BY id LIMIT 200`,
        peer,
        since,
      )
      .toArray()
      .map((row) => ({
        id: Number(row.id),
        from: String(row.from_peer),
        kind: String(row.kind),
        payload: JSON.parse(String(row.payload)),
      }));
    return json({ peers: this.roster(), signals });
  }

  async onPost(request) {
    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    if (!msg || typeof msg !== "object") return json({ error: "invalid request" }, 400);
    if (msg.op === "leave") {
      if (!ID.test(msg.room ?? "") || !ID.test(msg.peer ?? "")) return json({ error: "invalid request" }, 400);
      this.ctx.storage.sql.exec(`DELETE FROM peers WHERE id = ?`, msg.peer);
      return json({ ok: true });
    }
    if (msg.op !== "signal") return json({ error: "invalid request" }, 400);
    if (!ID.test(msg.room ?? "") || !ID.test(msg.from ?? "") || !ID.test(msg.to ?? "")) {
      return json({ error: "invalid request" }, 400);
    }
    if (msg.kind !== "offer" && msg.kind !== "answer" && msg.kind !== "ice") {
      return json({ error: "invalid request" }, 400);
    }
    let payload;
    try {
      payload = JSON.stringify(msg.payload);
    } catch {
      return json({ error: "invalid request" }, 400);
    }
    if (!payload || payload.length > 32_768) return json({ error: "payload too large" }, 400);
    this.ctx.storage.sql.exec(
      `INSERT INTO signals (to_peer, from_peer, kind, payload, created) VALUES (?, ?, ?, ?, ?)`,
      msg.to,
      msg.from,
      msg.kind,
      payload,
      Date.now(),
    );
    return json({ ok: true });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "vibe-rtc" });
    }
    if (url.pathname !== "/api/rtc") return json({ error: "not found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    let room = url.searchParams.get("room");
    let body;
    if (request.method === "POST") {
      body = await request.text();
      try {
        room = JSON.parse(body).room;
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
    }
    if (!room || !ID.test(room)) return json({ error: "invalid room" }, 400);

    const id = env.RTC.idFromName(room);
    const stub = env.RTC.get(id);
    return stub.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.method === "POST" ? body : undefined,
      }),
    );
  },
};
