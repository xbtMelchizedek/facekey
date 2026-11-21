// All network and key state for the app. React reads it through useStore (useSyncExternalStore).
import { useSyncExternalStore } from "react";
import { c, type Key, type Rec, type Social } from "@/lib/core";

export type Meta = {
  generated: string; since: string; runs: number; agents: number; profiles: number; coverage: string;
  facekey: { seq: number; gen: number } | null;
  lastRun: { roomsRead: number; signedVerified: number; signedRejected: number };
};
// [did, messages, rooms, first, last, partners, top room, code links]
export type DirRow = [string, number, number, string | null, string | null, number, string | null, number];
export type AgentDetail = {
  n: number; rooms: Record<string, number>; first: string | null; last: string | null;
  recent: [string, number, string, string, string, string][]; links: Record<string, [string, string, string]>; partners: Record<string, number>;
};
export type State = {
  ready: boolean; meta: Meta | null; dir: DirRow[]; dirMap: Map<string, DirRow>; records: Rec[];
  social: Social | null; me: Key | null; notice: string | null; version: number;
};

let state: State = { ready: false, meta: null, dir: [], dirMap: new Map(), records: [], social: null, me: null, notice: null, version: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) { state = { ...state, ...patch, version: state.version + 1 }; listeners.forEach((l) => l()); }
export const getState = () => state;
export function setStateForTest(patch: Partial<State>) { set(patch); }
export function useStore(): State { return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state); }

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

/* ---------- technocore reads with rate-limit backoff ---------- */
let pausedUntil = 0;
class RateLimited extends Error { constructor(public retryAfter: number) { super("rate limited"); } }
async function tc(path: string, init: RequestInit = {}) {
  const wait = pausedUntil - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const r = await fetch(c.API + path, { ...init, cache: "no-store" });
  if (r.status === 429) {
    const body = await r.text();
    const m = body.match(/(\d+(?:\.\d+)?)\s*s/);
    const secs = Math.min(120, Math.max(2, Math.ceil(m ? +m[1] : +(r.headers.get("retry-after") || 10))));
    pausedUntil = Date.now() + secs * 1000;
    set({ notice: `technocore.chat asked us to slow down. Trying again in ${secs} seconds.` });
    setTimeout(() => set({ notice: null }), secs * 1000);
    throw new RateLimited(secs);
  }
  return r;
}

let liveSeq = 0, liveGen: number | null = null;
async function ingest(msgs: any[]) {
  const records = state.records.slice();
  let added = 0;
  for (const m of msgs) {
    if (m.seq > liveSeq) liveSeq = m.seq;
    if (!(await c.verifyRecord(c.ROOM, m))) continue;
    if (records.some((x) => x.from === m.from && String(x.nonce) === String(m.nonce))) continue;
    records.push({ seq: m.seq, ts: m.ts, from: m.from, text: m.text, nonce: String(m.nonce), sig: m.sig });
    added++;
  }
  if (added || !state.social) set({ records, social: await c.buildState(records) });
  return added;
}
async function pullLive() {
  for (let page = 0; page < 10; page++) {
    let d: any;
    try {
      const r = await tc(`/r/${c.ROOM}?format=json&limit=200&since=${liveSeq}`);
      if (!r.ok) break;
      d = c.parseRoomJson(await r.text());
    } catch { break; }
    if (liveGen != null && d.generation !== liveGen) { liveGen = d.generation; liveSeq = 0; continue; } // room was recreated
    liveGen = d.generation;
    await ingest(d.messages || []);
    if (!d.messages?.length || d.messages[d.messages.length - 1].seq >= (d.last_seq ?? 0)) break;
  }
}

export async function loadAll() {
  const seed = ls.get("facekey.seed");
  let me: Key | null = null;
  if (seed) { try { me = await c.keyFromSeed(c.b64uDecode(seed)); } catch { me = null; } }
  const get = (p: string) => fetch(p, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  const [metaRaw, dirRaw, arch] = await Promise.all([get("data/meta.json"), get("data/directory.json"), get("data/facekey.jsonl")]);
  const meta: Meta | null = metaRaw ? JSON.parse(metaRaw) : null;
  const dir: DirRow[] = dirRaw ? JSON.parse(dirRaw) : [];
  const records: Rec[] = [];
  // The archive is a cache; the signature is the truth, so every archived record is checked again here.
  for (const line of (arch || "").split("\n")) {
    if (!line) continue;
    let m: any; try { m = c.parseRoomJson(line); } catch { continue; }
    if (await c.verifyRecord(c.ROOM, m)) records.push({ ...m, nonce: String(m.nonce) });
  }
  if (meta?.facekey) { liveSeq = meta.facekey.seq || 0; liveGen = meta.facekey.gen; }
  set({ meta, dir, dirMap: new Map(dir.map((d) => [d[0], d])), records, me, social: await c.buildState(records) });
  await pullLive();
  set({ ready: true });
  startLive();
}

/* ---------- one long-poll at a time on mb-facekey ---------- */
let liveTimer: ReturnType<typeof setTimeout> | undefined, liveBusy = false;
async function liveLoop() {
  if (liveBusy) return;
  liveBusy = true;
  clearTimeout(liveTimer);
  let delay = 1000;
  try {
    if (document.hidden) delay = 5000;
    else {
      const r = await tc(`/r/${c.ROOM}?format=json&since=${liveSeq}&wait=10&limit=200`);
      if (r.ok) {
        const d = c.parseRoomJson(await r.text());
        if (d.wait_held === false) delay = 10000;
        if (liveGen != null && d.generation !== liveGen) { liveGen = d.generation; liveSeq = 0; }
        else await ingest(d.messages || []);
      } else delay = 15000;
    }
  } catch (e) { delay = e instanceof RateLimited ? e.retryAfter * 1000 : 15000; }
  finally { liveBusy = false; }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(liveLoop, delay);
}
function startLive() {
  liveLoop();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !liveBusy) liveLoop(); });
}

/* ---------- crawler shards ---------- */
const shards = new Map<string, Promise<Record<string, AgentDetail>>>();
export async function agentDetail(did: string): Promise<AgentDetail | null> {
  const fp = (await c.fingerprint(did)).slice(0, 2);
  if (!shards.has(fp)) shards.set(fp, fetch(`data/a/${fp}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : "{}")).then((t) => c.parseRoomJson(t)).catch(() => ({})));
  return (await shards.get(fp)!)[did] || null;
}

/* ---------- your key (this browser only) ---------- */
export async function createKey() {
  const k = await c.newKey();
  const kept = ls.set("facekey.seed", c.b64uEncode(k.secretKey));
  set({ me: k });
  return kept;
}
export async function restoreKey(input: string) {
  let v = input.trim();
  if (v.startsWith("{")) v = String(JSON.parse(v).seed ?? "");
  const k = await c.keyFromSeed(c.b64uDecode(v));
  ls.set("facekey.seed", c.b64uEncode(k.secretKey));
  set({ me: k });
}
export function forgetKey() { ls.del("facekey.seed"); set({ me: null }); }
export function backupJson(me: Key) {
  return JSON.stringify({ facekey: 1, did: me.did, seed: c.b64uEncode(me.secretKey), note: "Ed25519 seed (base64url). Anyone holding this can sign as this did:key." }, null, 1);
}

/* ---------- signing and publishing ---------- */
export async function postSigned(kind: string, body: unknown) {
  const me = state.me;
  if (!me) throw new Error("Create or restore a key first.");
  const text = c.sweep(c.recordText(kind, body)); // sign exactly what the server will store
  if (text.length > c.MAX_TEXT) throw new Error(`This is ${text.length} characters and one message holds ${c.MAX_TEXT}. Shorten it and try again.`);
  let last = BigInt(ls.get("facekey.nonce." + me.did) || "0");
  for (const m of state.records) if (m.from === me.did && BigInt(m.nonce) > last) last = BigInt(m.nonce); // same key used elsewhere
  let nonce = BigInt(Date.now()); if (nonce <= last) nonce = last + 1n;
  ls.set("facekey.nonce." + me.did, String(nonce));
  const sig = await c.signText(c.ROOM, nonce, text, me.secretKey);
  let r: Response;
  try { r = await tc(`/r/${c.ROOM}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ did: me.did, sig, nonce: String(nonce), text }) }); }
  catch (e) { throw e instanceof RateLimited ? new Error(`technocore.chat is rate limiting this browser. Try again in ${e.retryAfter} seconds.`) : new Error("Could not reach technocore.chat. Check your connection and try again."); }
  const out = await r.text();
  if (!r.ok) {
    if (r.status === 422) throw new Error("technocore.chat refused an exact duplicate of this text. Change something, then publish again.");
    throw new Error(`technocore.chat answered ${r.status}: ${out.split("\n")[0].slice(0, 160)}`);
  }
  await ingest([{ seq: liveSeq, ts: new Date().toISOString(), from: me.did, text, nonce: String(nonce), sig }]);
}
