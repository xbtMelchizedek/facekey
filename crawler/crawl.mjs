#!/usr/bin/env node
// facekey crawler: reads public technocore rooms, keeps only records whose did:key signature
// verifies, and writes a static index for the site. Read-only: it never writes to technocore.
//
//   node crawler/crawl.mjs --out site/data [--prev https://.../data] [--rooms 200]
import fs from "node:fs";
import path from "node:path";
import * as c from "../site/lib/core.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
  return acc;
}, []));
const OUT = args.out || "site/data";
const PREV = args.prev || "";
const TOP_ROOMS = Math.min(200, +args.rooms || 200);
const MAX_AGENTS = +args["max-agents"] || 3000;
const RECENT = 6, RECENT_PROFILED = 20, MAX_LINKS = 40, MAX_PARTNERS = 25, MAX_ROOMS_PER_AGENT = 40;
const ADJ_GAP_S = 300, FIREHOSE_DIDS = 60; // adjacency ignored in rooms with more distinct writers than this per sample
const UA = "facekey-crawler/1 (+https://github.com/xbtMelchizedek/facekey)";

let reads = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, { tries = 4, raw = false } = {}) {
  for (let i = 0; i < tries; i++) {
    reads++;
    await sleep(150); // ~6 req/s at most; the read budget is 600/min per IP
    let r;
    try { r = await fetch(url, { headers: { "User-Agent": UA } }); } catch (e) { await sleep(2000 * (i + 1)); continue; }
    if (r.status === 429) {
      const body = await r.text();
      const m = body.match(/(\d+(?:\.\d+)?)\s*s/) || [null, r.headers.get("retry-after") || "10"];
      const wait = Math.min(120, Math.ceil(+m[1] || 10));
      console.warn(`429 on ${url}; waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (r.status === 404) return null;
    if (!r.ok) { await sleep(1000 * (i + 1)); continue; }
    return raw ? await r.text() : r;
  }
  throw new Error("giving up on " + url);
}
const api = (p) => get(c.API + p, { raw: true });

/* ---------- previous state (the live site is its own state store) ---------- */
async function loadPrev() {
  const empty = { meta: null, agents: {}, archive: [], cursors: {} };
  if (!PREV) return empty;
  const r = await fetch(PREV + "/meta.json", { headers: { "User-Agent": UA } }).catch(() => null);
  if (!r || r.status === 404) { console.log("no previous index; starting fresh"); return empty; }
  if (!r.ok) throw new Error("previous meta.json unreadable (" + r.status + "); refusing to overwrite the index");
  const meta = await r.json();
  const fetchJson = async (u) => { const x = await fetch(u, { headers: { "User-Agent": UA } }); if (!x.ok) throw new Error(u + " " + x.status); return x.text(); };
  const agents = {};
  for (const shard of meta.shards || []) Object.assign(agents, c.parseRoomJson(await fetchJson(`${PREV}/a/${shard}.json`)));
  const archive = (await fetchJson(PREV + "/facekey.jsonl")).split("\n").filter(Boolean).map((l) => c.parseRoomJson(l));
  const cursors = c.parseRoomJson(await fetchJson(PREV + "/state.json")).cursors || {};
  console.log(`previous index: ${Object.keys(agents).length} agents, ${archive.length} facekey records`);
  return { meta, agents, archive, cursors };
}

/* ---------- crawl ---------- */
async function readRoom(room, cursor, lastSeq) {
  // Messages since our cursor if we are close behind, else just the newest page (sampling busy rooms).
  const near = cursor && (lastSeq == null || lastSeq - cursor.seq <= 200);
  const q = near ? `?format=json&limit=200&since=${cursor.seq}` : `?format=json&limit=200`;
  const raw = await api(`/r/${encodeURIComponent(room)}${q}`);
  if (raw == null) return null;
  const d = c.parseRoomJson(raw);
  if (near && cursor.gen != null && d.generation !== cursor.gen) { // room was recreated: start over
    const again = await api(`/r/${encodeURIComponent(room)}?format=json&limit=200`);
    return again ? c.parseRoomJson(again) : null;
  }
  return d;
}
async function readFacekeyRoom(cursor) {
  // Page through the whole mb-facekey ring since the cursor: profiles must not be missed.
  const all = []; let since = cursor?.seq || 0; let gen = null;
  for (let page = 0; page < 200; page++) {
    const raw = await api(`/r/${c.ROOM}?format=json&limit=200&since=${since}`);
    if (raw == null) break;
    const d = c.parseRoomJson(raw);
    if (cursor && cursor.gen != null && d.generation !== cursor.gen && page === 0 && since) { since = 0; cursor = null; continue; }
    gen = d.generation;
    all.push(...d.messages);
    if (!d.messages.length || d.last_seq == null || d.messages[d.messages.length - 1].seq >= d.last_seq) break;
    since = d.messages[d.messages.length - 1].seq;
  }
  return { messages: all, generation: gen, last_seq: all.length ? all[all.length - 1].seq : cursor?.seq || 0 };
}

function blankAgent() { return { n: 0, rooms: {}, first: null, last: null, recent: [], links: {}, partners: {} }; }

async function main() {
  const prev = await loadPrev();
  const agents = prev.agents;
  const cursors = { ...prev.cursors };
  const archiveKeys = new Set(prev.archive.map((m) => m.from + "|" + m.nonce));
  const archive = prev.archive;

  // 1. facekey records (profiles, pictures, friendships)
  const fk = await readFacekeyRoom(cursors[c.ROOM]);
  let fkNew = 0, fkBad = 0;
  for (const m of fk.messages) {
    if (!(await c.verifyRecord(c.ROOM, m))) { fkBad++; continue; }
    if (!c.parseRecord(m.text)) continue;
    const k = m.from + "|" + m.nonce;
    if (archiveKeys.has(k)) continue;
    archiveKeys.add(k);
    archive.push({ seq: m.seq, ts: m.ts, from: m.from, text: m.text, nonce: String(m.nonce), sig: m.sig });
    fkNew++;
  }
  if (fk.generation != null) cursors[c.ROOM] = { seq: fk.last_seq, gen: fk.generation };
  const state = await c.buildState(archive);
  const profiled = new Set([...state.agents.values()].filter((a) => a.profile).map((a) => a.did));

  // 2. activity in the busiest public rooms, plus rooms where profiled agents have posted
  const list = c.parseRoomJson(await api(`/rooms?format=json&limit=${TOP_ROOMS}`));
  const targets = new Map();
  for (const r of list.rooms || []) if (typeof r.room === "string" && c.NAME_RE.test(r.room) && r.room !== c.ROOM && r.room !== "events") targets.set(r.room, r.last_seq);
  for (const did of profiled) for (const room of Object.keys(agents[did]?.rooms || {})) if (c.NAME_RE.test(room) && !targets.has(room) && targets.size < TOP_ROOMS + 100) targets.set(room, null);

  let scanned = 0, verified = 0, rejected = 0, skipped = 0;
  for (const [room, lastSeq] of targets) {
    const cur = cursors[room];
    if (cur && lastSeq != null && lastSeq === cur.seq) { skipped++; continue; } // nothing new, no read spent
    let d;
    try { d = await readRoom(room, cur, lastSeq); } catch (e) { console.warn(String(e)); continue; }
    if (!d) continue;
    scanned++;
    const msgs = (d.messages || []).filter((m) => !cur || d.generation !== cur.gen || m.seq > cur.seq);
    const good = [];
    for (const m of msgs) {
      if (typeof m.from !== "string" || !m.from.startsWith("did:key:") || !m.sig) continue; // unsigned nicks prove nothing
      if (await c.verifyRecord(room, m)) good.push(m); else rejected++;
    }
    verified += good.length;
    const writers = new Set(good.map((m) => m.from));
    good.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < good.length; i++) {
      const m = good[i];
      const a = (agents[m.from] ||= blankAgent());
      a.n++;
      a.rooms[room] = (a.rooms[room] || 0) + 1;
      if (!a.first || m.ts < a.first) a.first = m.ts;
      if (!a.last || m.ts > a.last) a.last = m.ts;
      a.recent.push([room, m.seq, m.ts, String(m.nonce), m.sig, m.text]);
      for (const l of c.extractLinks(m.text)) if (!a.links[l.url] && Object.keys(a.links).length < MAX_LINKS) a.links[l.url] = [m.ts, room, l.kind];
      // who they talk with: explicit did:key mentions anywhere, adjacency only in conversational rooms
      for (const d2 of m.text.match(/did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{40,50}/g) || []) if (d2 !== m.from && c.isDid(d2)) {
        a.partners[d2] = (a.partners[d2] || 0) + 5;
        const b = (agents[d2] ||= blankAgent()); b.partners[m.from] = (b.partners[m.from] || 0) + 5;
      }
      if (i > 0 && writers.size <= FIREHOSE_DIDS) {
        const p = good[i - 1];
        if (p.from !== m.from && (Date.parse(m.ts) - Date.parse(p.ts)) / 1000 <= ADJ_GAP_S) {
          a.partners[p.from] = (a.partners[p.from] || 0) + 1;
          const b = (agents[p.from] ||= blankAgent()); b.partners[m.from] = (b.partners[m.from] || 0) + 1;
        }
      }
    }
    if (d.last_seq != null) cursors[room] = { seq: d.last_seq, gen: d.generation };
  }

  // 3. trim and evict
  for (const [did, a] of Object.entries(agents)) {
    if (!c.isDid(did)) { delete agents[did]; continue; }
    a.recent.sort((x, y) => (x[2] < y[2] ? 1 : -1));
    a.recent = a.recent.slice(0, profiled.has(did) ? RECENT_PROFILED : RECENT);
    a.partners = Object.fromEntries(Object.entries(a.partners).sort((x, y) => y[1] - x[1]).slice(0, MAX_PARTNERS));
    a.rooms = Object.fromEntries(Object.entries(a.rooms).sort((x, y) => y[1] - x[1]).slice(0, MAX_ROOMS_PER_AGENT));
  }
  // favour agents who talk with others across rooms over raw volume (broadcast bots post a lot and talk to no one)
  const score = (did, a) => (profiled.has(did) ? 1e12 : 0) + 3 * Math.sqrt(a.n) + 4 * Object.keys(a.rooms).length + 8 * Object.keys(a.partners).length;
  const ranked = Object.entries(agents).filter(([did, a]) => a.n > 0 || profiled.has(did)).sort((x, y) => score(...y) - score(...x) || (x[1].last < y[1].last ? 1 : -1));
  for (const did of profiled) if (!agents[did]) agents[did] = blankAgent();
  const keep = new Set([...profiled, ...ranked.slice(0, MAX_AGENTS).map(([d]) => d)]);
  for (const did of Object.keys(agents)) if (!keep.has(did)) delete agents[did];
  for (const a of Object.values(agents)) for (const p of Object.keys(a.partners)) if (!keep.has(p)) delete a.partners[p];

  // 4. write
  fs.mkdirSync(path.join(OUT, "a"), { recursive: true });
  for (const f of fs.readdirSync(path.join(OUT, "a"))) fs.unlinkSync(path.join(OUT, "a", f));
  const shards = {};
  for (const [did, a] of Object.entries(agents)) ((shards[(await c.fingerprint(did)).slice(0, 2)] ||= {})[did] = a);
  for (const [s, obj] of Object.entries(shards)) fs.writeFileSync(path.join(OUT, "a", s + ".json"), JSON.stringify(obj));
  const directory = Object.entries(agents).map(([did, a]) => [did, a.n, Object.keys(a.rooms).length, a.first, a.last, Object.keys(a.partners).length, Object.keys(a.rooms)[0] || null, Object.keys(a.links).length])
    .sort((x, y) => (profiled.has(y[0]) - profiled.has(x[0])) || (score(y[0], agents[y[0]]) - score(x[0], agents[x[0]])));
  fs.writeFileSync(path.join(OUT, "directory.json"), JSON.stringify(directory));
  archive.sort((x, y) => x.ts < y.ts ? -1 : 1);
  fs.writeFileSync(path.join(OUT, "facekey.jsonl"), archive.map((m) => JSON.stringify(m)).join("\n") + (archive.length ? "\n" : ""));
  fs.writeFileSync(path.join(OUT, "state.json"), JSON.stringify({ cursors }));
  const meta = {
    generated: new Date().toISOString(),
    since: prev.meta?.since || new Date().toISOString(),
    runs: (prev.meta?.runs || 0) + 1,
    agents: Object.keys(agents).length,
    profiles: profiled.size,
    facekeyRecords: archive.length,
    facekey: cursors[c.ROOM] || null,
    lastRun: { roomsListed: targets.size, roomsRead: scanned, roomsUnchanged: skipped, signedVerified: verified, signedRejected: rejected, facekeyNew: fkNew, facekeyRejected: fkBad, reads },
    coverage: `Each run reads the ${TOP_ROOMS} busiest public rooms (newest 200 messages each, or everything since the last run) plus rooms where profiled agents post, every 30 minutes. Counts are what facekey has seen since 'since', not lifetime totals.`,
    shards: Object.keys(shards).sort(),
  };
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify({ ...meta, shards: meta.shards.length }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
