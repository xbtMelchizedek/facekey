import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as c from "../lib/core.js";

const fixture = c.parseRoomJson(fs.readFileSync(new URL("./fixtures/builders.json", import.meta.url), "utf8"));

async function signed(key, text, room = c.ROOM, nonce = String(Date.now())) {
  const t = c.sweep(text);
  return { seq: 1, ts: new Date().toISOString(), from: key.did, text: t, nonce, sig: await c.signText(room, nonce, t, key.secretKey) };
}
const jpegB64 = c.b64Encode(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]));

test("real technocore records verify, with 13- and 19-digit nonces", async () => {
  assert.ok(fixture.messages.length > 0);
  for (const m of fixture.messages) assert.equal(await c.verifyRecord("builders", m), true, m.seq);
});

test("parseRoomJson keeps 19-digit nonces exact", () => {
  const d = c.parseRoomJson('{"messages":[{"nonce": 1795264818788881369,"text":"x"}]}');
  assert.equal(d.messages[0].nonce, "1795264818788881369");
  assert.notEqual(String(JSON.parse('{"n":1795264818788881369}').n), "1795264818788881369");
});

test("tampering breaks verification: text, room, nonce, signer, sig", async () => {
  const m = fixture.messages[0];
  assert.equal(await c.verifyRecord("builders", { ...m, text: m.text + " " }), false);
  assert.equal(await c.verifyRecord("lobby", m), false);
  assert.equal(await c.verifyRecord("builders", { ...m, nonce: String(BigInt(m.nonce) + 1n) }), false);
  const other = fixture.messages.find((x) => x.from !== m.from);
  if (other) assert.equal(await c.verifyRecord("builders", { ...m, from: other.from }), false);
  const flipped = (m.sig[0] === "A" ? "B" : "A") + m.sig.slice(1);
  assert.equal(await c.verifyRecord("builders", { ...m, sig: flipped }), false);
});

test("non-canonical and malformed signatures are rejected without throwing", async () => {
  const m = fixture.messages[0];
  const last = m.sig.at(-1);
  const alt = { A: "B", Q: "R", g: "h", w: "x" }[last];
  assert.equal(await c.verifyRecord("builders", { ...m, sig: m.sig.slice(0, -1) + alt }), false);
  for (const bad of [null, {}, { ...m, sig: "short" }, { ...m, nonce: "12a" }, { ...m, from: "did:key:zQ3s" }, { ...m, nonce: "1".repeat(20) }])
    assert.equal(await c.verifyRecord("builders", bad), false);
});

test("our own signer round-trips and matches the server's canonical form", async () => {
  const k = await c.newKey();
  assert.match(k.did, c.DID_RE);
  assert.deepEqual(c.publicKeyToDid(c.didToPublicKey(k.did)), k.did);
  const m = await signed(k, c.recordText("profile", { name: "Tester", bio: "", pfp: null, builds: [] }));
  assert.match(m.sig, /^[A-Za-z0-9_-]{85}[AQgw]$/);
  assert.equal(await c.verifyRecord(c.ROOM, m), true);
  assert.equal(await c.verifyRecord("lobby", m), false, "bound to the room");
});

test("sweep mirrors the server: controls, format chars, line separators become spaces", () => {
  assert.equal(c.sweep("a\nb\u200bc\u2028d\u202ee\t"), "a b c d e");
  assert.equal(c.sweep("  ok  "), "ok");
});

test("did:key parsing and fingerprint", async () => {
  const did = fixture.messages[0].from;
  assert.equal(c.didToPublicKey(did).length, 32);
  assert.throws(() => c.didToPublicKey("did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme"));
  assert.equal(c.isDid("did:web:example.com"), false);
  assert.match(await c.fingerprint(did), /^[0-9a-f]{16}$/);
});

test("parseRecord validates every kind and rejects junk", () => {
  const p = c.parseRecord(c.recordText("profile", { name: "Ada", bio: "builds things", pfp: "a".repeat(64), builds: [{ t: "site", u: "https://example.com/x" }, { t: "bad", u: "javascript:alert(1)" }, { t: "http", u: "http://example.com" }] }));
  assert.equal(p.name, "Ada"); assert.equal(p.builds.length, 1);
  assert.equal(c.parseRecord(c.recordText("profile", { name: "" })), null);
  assert.equal(c.parseRecord(c.recordText("profile", { name: "x".repeat(41) })), null);
  assert.equal(c.parseRecord(c.recordText("profile", { name: "line\nbreak" })), null, "decoded control chars rejected");
  assert.equal(c.parseRecord(c.recordText("profile", { name: "ok", pfp: "notahash" })), null);
  assert.equal(c.parseRecord(c.recordText("profile", { name: "ok", bio: "b".repeat(281) })), null);
  assert.equal(c.parseRecord(c.recordText("pfp", { jpeg: c.b64Encode(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])) })), null, "PNG bytes refused");
  assert.equal(c.parseRecord(c.recordText("pfp", { jpeg: "<svg onload=x>" })), null);
  assert.equal(c.parseRecord(c.recordText("pfp", { jpeg: jpegB64 })).kind, "pfp");
  assert.equal(c.parseRecord(c.recordText("friend", { to: "nobody" })), null);
  assert.equal(c.parseRecord(c.recordText("poke", { to: fixture.messages[0].from })), null);
  for (const junk of ["hello", "facekey/1", "facekey/1 profile", "facekey/1 profile {", "facekey/1 profile []", "facekey/2 profile {\"name\":\"a\"}", 42, null])
    assert.equal(c.parseRecord(junk), null);
});

test("pfp budget: the largest allowed JPEG still fits one message", () => {
  const big = new Uint8Array(c.PFP_MAX_BYTES); big.set([0xff, 0xd8, 0xff]);
  const text = c.recordText("pfp", { jpeg: c.b64Encode(big) });
  assert.ok(text.length <= c.MAX_TEXT, text.length);
  const tooBig = new Uint8Array(c.PFP_MAX_BYTES + 3); tooBig.set([0xff, 0xd8, 0xff]);
  assert.ok(c.recordText("pfp", { jpeg: c.b64Encode(tooBig) }).length > c.MAX_TEXT);
});

test("state: newest signed profile wins, pictures need a matching hash", async () => {
  const k = await c.newKey();
  const sha = await c.sha256hex(c.b64Decode(jpegB64));
  const recs = [
    await signed(k, c.recordText("pfp", { jpeg: jpegB64 }), c.ROOM, "100"),
    await signed(k, c.recordText("profile", { name: "New", pfp: sha }), c.ROOM, "300"),
    await signed(k, c.recordText("profile", { name: "Old", pfp: null }), c.ROOM, "200"), // replayed older record arrives later
  ];
  let st = await c.buildState(recs);
  assert.equal(st.profile(k.did).name, "New");
  assert.equal(st.profile(k.did).jpeg, jpegB64);
  st = await c.buildState([recs[1]]); // picture record missing: show no image
  assert.equal(st.profile(k.did).jpeg, null);
  const wrong = await signed(k, c.recordText("profile", { name: "X", pfp: "b".repeat(64) }), c.ROOM, "400");
  st = await c.buildState([...recs, wrong]);
  assert.equal(st.profile(k.did).jpeg, null, "hash mismatch shows no picture");
});

test("big nonces compare as integers, not strings or floats", async () => {
  const k = await c.newKey();
  const st = await c.buildState([
    await signed(k, c.recordText("profile", { name: "A" }), c.ROOM, "1795264818788881370"),
    await signed(k, c.recordText("profile", { name: "B" }), c.ROOM, "1795264818788881369"),
    await signed(k, c.recordText("profile", { name: "C" }), c.ROOM, "999"),
  ]);
  assert.equal(st.profile(k.did).name, "A");
});

test("friends are mutual; requests, accepts and unfriend", async () => {
  const [a, b, x] = [await c.newKey(), await c.newKey(), await c.newKey()];
  const req = await signed(a, c.recordText("friend", { to: b.did }), c.ROOM, "10");
  let st = await c.buildState([req]);
  assert.deepEqual(st.friends(a.did), []);
  assert.deepEqual(st.incoming(b.did), [a.did]);
  assert.deepEqual(st.outgoing(a.did), [b.did]);
  assert.equal(st.relation(b.did, a.did), "incoming");
  const acc = await signed(b, c.recordText("friend", { to: a.did }), c.ROOM, "11");
  st = await c.buildState([req, acc]);
  assert.deepEqual(st.friends(a.did), [b.did]); assert.deepEqual(st.friends(b.did), [a.did]);
  assert.equal(st.relation(a.did, b.did), "friends");
  assert.deepEqual(st.incoming(b.did), []);
  const un = await signed(b, c.recordText("unfriend", { to: a.did }), c.ROOM, "12");
  st = await c.buildState([req, acc, un]);
  assert.deepEqual(st.friends(a.did), []);
  // a third key cannot make b friends with anyone: stance only comes from the signer
  const forged = await signed(x, c.recordText("friend", { to: a.did }), c.ROOM, "13");
  st = await c.buildState([req, forged]);
  assert.deepEqual(st.friends(a.did), []);
  // self-friendship is ignored
  st = await c.buildState([await signed(a, c.recordText("friend", { to: a.did }), c.ROOM, "14")]);
  assert.deepEqual(st.friends(a.did), []);
});

test("extractLinks finds GitHub PRs, issues, commits and repos only", () => {
  const ls = c.extractLinks("see https://github.com/flop-labs/network/pull/229, https://github.com/xbtMelchizedek/flopscan. and https://github.com/a/b/commit/abcdef1 and https://github.com/a/b/issues/7 and https://evil.example/github.com/x/y and javascript:https://github.com/q");
  assert.deepEqual(ls.map((l) => [l.kind, l.url]), [
    ["pr", "https://github.com/flop-labs/network/pull/229"],
    ["repo", "https://github.com/xbtMelchizedek/flopscan"],
    ["commit", "https://github.com/a/b/commit/abcdef1"],
    ["issue", "https://github.com/a/b/issues/7"],
  ]);
});

test("cleanUrl only passes https URLs", () => {
  assert.equal(c.cleanUrl("https://example.com/a"), "https://example.com/a");
  for (const u of ["javascript:alert(1)", "http://example.com", "data:text/html,x", "https://", "https://localhost", "https://a.b/" + "x".repeat(300), 5]) assert.equal(c.cleanUrl(u), null);
});

test("a lobby record with a 19-digit nonce verifies from raw JSON", async () => {
  const d = c.parseRoomJson(fs.readFileSync(new URL("./fixtures/lobby-bignonce.json", import.meta.url), "utf8"));
  assert.ok(d.messages.length === 1 && d.messages[0].nonce.length === 19);
  assert.equal(await c.verifyRecord("lobby", d.messages[0]), true);
});
