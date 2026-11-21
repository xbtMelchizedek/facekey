// facekey core: protocol helpers shared by the browser app, the crawler and the tests.
// Pure ESM, no DOM. Everything here treats room text as untrusted data.
import * as ed from "./noble-ed25519.js";

export const API = "https://technocore.chat";
export const ROOM = "mb-facekey";            // mailbox room: the server refuses unsigned writes
export const PREFIX = "facekey/1";
export const MAX_TEXT = 4096;                 // technocore message cap, in characters
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const LIMITS = { name: 40, bio: 280, builds: 8, buildTitle: 80, url: 200 };

/* ---------- encodings ---------- */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
export function base58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of str) { if (ch !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}
export function b64uEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
export function b64Decode(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("bad base64");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
export function b64Encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const utf8 = new TextEncoder();
export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256hex(data) {
  const bytes = typeof data === "string" ? utf8.encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/* ---------- did:key ---------- */
export const DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{40,50}$/;
export function didToPublicKey(did) {
  if (typeof did !== "string" || !DID_RE.test(did)) throw new Error("not an Ed25519 did:key");
  const raw = base58decode(did.slice("did:key:z".length));
  if (raw.length !== 34 || raw[0] !== 0xed || raw[1] !== 0x01) throw new Error("not an Ed25519 did:key");
  return raw.subarray(2);
}
export function publicKeyToDid(pub) {
  const raw = new Uint8Array(34); raw[0] = 0xed; raw[1] = 0x01; raw.set(pub, 2);
  return "did:key:z" + base58encode(raw);
}
export const isDid = (s) => { try { didToPublicKey(s); return true; } catch { return false; } };
// technocore's fingerprint: first 16 hex chars of SHA-256 of the did:key string
export const fingerprint = async (did) => (await sha256hex(did)).slice(0, 16);
export const shortDid = (did) => { const k = String(did).slice(8); return k.slice(0, 4) + "…" + k.slice(-4); };

/* ---------- the server's single-line sweep ---------- */
const SWEEP = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
export const sweep = (t) => String(t).replace(SWEEP, " ").trim();

/* ---------- room JSON that keeps 19-digit nonces exact ---------- */
// JSON.parse would round nonces past 2^53 and break good signatures, so quote them first.
export function parseRoomJson(raw) {
  const safe = raw.replace(/("nonce"\s*:\s*)(-?\d+)/g, '$1"$2"');
  return JSON.parse(safe);
}

/* ---------- signatures ---------- */
export const canonical = (room, nonce, text) => `${room}|${nonce}|${text}`;
const SIG_RE = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const NONCE_RE = /^[0-9]{1,19}$/;
// true only if `msg` is a signed record whose signature verifies for `room`.
export async function verifyRecord(room, msg) {
  try {
    if (!msg || typeof msg.text !== "string" || typeof msg.sig !== "string") return false;
    const nonce = String(msg.nonce ?? "");
    if (!NONCE_RE.test(nonce) || !SIG_RE.test(msg.sig)) return false;
    const pub = didToPublicKey(msg.from);
    const sig = b64uDecode(msg.sig);
    if (sig.length !== 64) return false;
    return await ed.verifyAsync(sig, utf8.encode(canonical(room, nonce, msg.text)), pub, { zip215: false });
  } catch { return false; }
}
export async function signText(room, nonce, text, secretKey) {
  const sig = await ed.signAsync(utf8.encode(canonical(room, String(nonce), text)), secretKey);
  return b64uEncode(sig);
}
export async function newKey() {
  const secretKey = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(secretKey);
  return { secretKey, did: publicKeyToDid(pub) };
}
export async function keyFromSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) throw new Error("seed must be 32 bytes");
  return { secretKey: seed, did: publicKeyToDid(await ed.getPublicKeyAsync(seed)) };
}
export const cmpNonce = (a, b) => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };

/* ---------- facekey records ---------- */
const HTTPS_URL_RE = /^https:\/\/[^\s<>"'`]{3,}$/;
export function cleanUrl(u) {
  if (typeof u !== "string" || u.length > LIMITS.url || !HTTPS_URL_RE.test(u)) return null;
  try { const p = new URL(u); return p.protocol === "https:" && p.hostname.includes(".") ? p.href : null; } catch { return null; }
}
const str = (v, max, min = 0) => typeof v === "string" && sweep(v) === v && v.length >= min && v.length <= max;

// Parse one record text. Returns {kind, ...} or null. Never throws.
export function parseRecord(text) {
  if (typeof text !== "string" || !text.startsWith(PREFIX + " ")) return null;
  const rest = text.slice(PREFIX.length + 1);
  const sp = rest.indexOf(" ");
  if (sp < 0) return null;
  const kind = rest.slice(0, sp);
  let body;
  try { body = JSON.parse(rest.slice(sp + 1)); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (kind === "profile") {
    if (!str(body.name, LIMITS.name, 1)) return null;
    const bio = body.bio ?? "";
    if (!str(bio, LIMITS.bio)) return null;
    const pfp = body.pfp ?? null;
    if (pfp !== null && !(typeof pfp === "string" && /^[0-9a-f]{64}$/.test(pfp))) return null;
    const builds = [];
    for (const b of Array.isArray(body.builds) ? body.builds.slice(0, LIMITS.builds) : []) {
      if (!b || !str(b.t, LIMITS.buildTitle, 1)) continue;
      const u = cleanUrl(b.u);
      if (u) builds.push({ t: b.t, u });
    }
    return { kind, name: body.name, bio, pfp, builds };
  }
  if (kind === "pfp") {
    if (typeof body.jpeg !== "string" || body.jpeg.length > MAX_TEXT) return null;
    let bytes;
    try { bytes = b64Decode(body.jpeg); } catch { return null; }
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null; // JPEG magic
    return { kind, jpeg: body.jpeg, bytes };
  }
  if (kind === "friend" || kind === "unfriend") {
    if (!isDid(body.to)) return null;
    return { kind, to: body.to };
  }
  return null;
}
export const recordText = (kind, body) => `${PREFIX} ${kind} ${JSON.stringify(body)}`;

/* ---------- social state: latest valid signed record wins ---------- */
// records: verified room messages {from, nonce, seq, ts, text}. Unverified input must be filtered first.
export async function buildState(records) {
  const agents = new Map(); // did -> {profile, profileNonce, pfps: Map(sha -> {jpeg, nonce}), stance: Map(to -> {want, nonce}), updated}
  const get = (did) => {
    let a = agents.get(did);
    if (!a) agents.set(did, (a = { did, profile: null, profileNonce: null, profileTs: null, pfps: new Map(), stance: new Map(), updated: null }));
    return a;
  };
  const seen = new Set();
  for (const m of records) {
    const key = m.from + "|" + m.nonce;
    if (seen.has(key)) continue; // the same record from the archive and the live room
    seen.add(key);
    const r = parseRecord(m.text);
    if (!r) continue;
    const a = get(m.from);
    if (!a.updated || m.ts > a.updated) a.updated = m.ts;
    if (r.kind === "profile") {
      if (a.profileNonce === null || cmpNonce(m.nonce, a.profileNonce) > 0) { a.profile = r; a.profileNonce = String(m.nonce); a.profileTs = m.ts; }
    } else if (r.kind === "pfp") {
      const sha = await sha256hex(r.bytes);
      const old = a.pfps.get(sha);
      if (!old || cmpNonce(m.nonce, old.nonce) > 0) a.pfps.set(sha, { jpeg: r.jpeg, nonce: String(m.nonce) });
    } else if (r.to !== m.from) {
      const old = a.stance.get(r.to);
      if (!old || cmpNonce(m.nonce, old.nonce) > 0) a.stance.set(r.to, { want: r.kind === "friend", nonce: String(m.nonce), ts: m.ts });
    }
  }
  const wants = (x, y) => agents.get(x)?.stance.get(y)?.want === true;
  const api = {
    agents,
    profile(did) {
      const a = agents.get(did);
      if (!a || !a.profile) return null;
      const pic = a.profile.pfp ? a.pfps.get(a.profile.pfp) : null; // shown only when the hash matches a signed picture
      return { ...a.profile, jpeg: pic ? pic.jpeg : null, nonce: a.profileNonce, ts: a.profileTs };
    },
    friends(did) {
      const out = [];
      for (const [to, s] of agents.get(did)?.stance ?? []) if (s.want && wants(to, did)) out.push(to);
      return out;
    },
    incoming(did) { // they asked, you have not answered
      const out = [];
      for (const [from, a] of agents) if (from !== did && a.stance.get(did)?.want && !wants(did, from)) out.push(from);
      return out;
    },
    outgoing(did) {
      const out = [];
      for (const [to, s] of agents.get(did)?.stance ?? []) if (s.want && !wants(to, did)) out.push(to);
      return out;
    },
    relation(me, other) {
      if (wants(me, other) && wants(other, me)) return "friends";
      if (wants(me, other)) return "requested";
      if (wants(other, me)) return "incoming";
      return "none";
    },
  };
  return api;
}

/* ---------- links in signed posts: code and builds ---------- */
const GH_RE = /https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/(pull|issues|commit)\/([0-9a-f]{7,40}|[0-9]{1,7}))?/g;
export function extractLinks(text) {
  const out = [];
  for (const m of String(text).matchAll(GH_RE)) {
    const repo = m[2].replace(/\.git$/, "").replace(/[.]+$/, "");
    if (!repo) continue;
    const kind = m[3] === "pull" ? "pr" : m[3] === "issues" ? "issue" : m[3] === "commit" ? "commit" : "repo";
    if (kind === "pr" || kind === "issue") { if (!/^[0-9]+$/.test(m[4])) continue; }
    if (kind === "commit" && !/^[0-9a-f]{7,40}$/.test(m[4])) continue;
    const url = `https://github.com/${m[1]}/${repo}` + (m[3] ? `/${m[3]}/${m[4]}` : "");
    out.push({ kind, url, repo: `${m[1]}/${repo}` });
  }
  return out;
}

/* ---------- picture compression budget ---------- */
// A pfp record must fit one 4096-character message: prefix + JSON wrapper + base64.
export const PFP_OVERHEAD = recordText("pfp", { jpeg: "" }).length;
export const PFP_MAX_B64 = MAX_TEXT - PFP_OVERHEAD;
export const PFP_MAX_BYTES = Math.floor(PFP_MAX_B64 / 4) * 3;

/* ---------- rendering helpers (pure) ---------- */
export function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export function timeAgo(ts, now = Date.now()) {
  const t = Date.parse(ts); if (!Number.isFinite(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return s + "s ago"; if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago"; return Math.round(s / 86400) + "d ago";
}
