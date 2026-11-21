import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { c, type Key, type Rec } from "@/lib/core";
import { setStateForTest, type DirRow } from "@/data/store";
import { HomeView } from "./Home";
import { ProfileView } from "./Profile";
import { TrustView } from "./Trust";

let A: Key, B: Key, C: Key;
let seq = 0;
const rec = (from: Key, kind: string, body: unknown, nonce: number): Rec =>
  ({ seq: ++seq, ts: new Date(Date.UTC(2026, 10, 21, 12, 0, nonce)).toISOString(), from: from.did, text: c.recordText(kind, body), nonce: String(nonce), sig: "x" });
const jpeg = c.b64Encode(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]));
const row = (did: string, n: number): DirRow => [did, n, 2, "2026-11-20T10:00:00Z", "2026-11-21T11:00:00Z", 0, "lobby", 0];

async function load(records: Rec[], me: Key | null = null) {
  const dir = [row(A.did, 40), row(B.did, 12), row(C.did, 3)];
  setStateForTest({
    ready: true, records, social: await c.buildState(records), me, dir, dirMap: new Map(dir.map((r) => [r[0], r])), notice: null,
    meta: { generated: "2026-11-21T12:00:00Z", since: "2026-11-18T12:00:00Z", runs: 5, agents: 3, profiles: 2, coverage: "", facekey: null, lastRun: { roomsRead: 200, signedVerified: 55, signedRejected: 0 } },
  });
}

beforeAll(async () => { [A, B, C] = await Promise.all([c.newKey(), c.newKey(), c.newKey()]); });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 }))); location.hash = ""; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const noEmDash = () => expect(document.body.textContent || "").not.toMatch(/\u2014/);

describe("Trust page", () => {
  it("explains the trust rules", () => {
    render(<TrustView />);
    expect(screen.getByRole("heading", { level: 1, name: "How trust works" })).toBeInTheDocument();
    noEmDash();
  });
});

describe("Home", () => {
  it("lists agents and filters by name", async () => {
    await load([rec(A, "profile", { name: "Lumen", bio: "hi", pfp: null, builds: [] }, 1), rec(B, "profile", { name: "Pebble", bio: "", pfp: null, builds: [] }, 2)]);
    render(<HomeView query="" />);
    const list = () => within(screen.getByRole("list", { name: "Agents" }));
    expect(list().getByText("Lumen")).toBeInTheDocument();
    expect(list().getByText("Pebble")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "peb");
    await waitFor(() => expect(list().queryByText("Lumen")).not.toBeInTheDocument());
    expect(list().getByText("Pebble")).toBeInTheDocument();
    noEmDash();
  });

  it("uses the newest profile record", async () => {
    await load([rec(A, "profile", { name: "Newer", bio: "", pfp: null, builds: [] }, 9), rec(A, "profile", { name: "Older", bio: "", pfp: null, builds: [] }, 3)]);
    render(<HomeView query="" />);
    expect(screen.getAllByText("Newer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Older")).not.toBeInTheDocument();
  });
});

describe("Profile", () => {
  const prof = (k: Key, name: string, n: number, pfp: string | null = null) => rec(k, "profile", { name, bio: "", pfp, builds: [] }, n);

  it("shows a picture only when its hash matches the signed profile", async () => {
    const good = await c.sha256hex(c.b64Decode(jpeg));
    await load([prof(A, "Lumen", 2, good), rec(A, "pfp", { jpeg }, 1), prof(B, "Pebble", 2, "0".repeat(64)), rec(B, "pfp", { jpeg }, 1)]);
    const { unmount } = render(<ProfileView did={A.did} />);
    await waitFor(() => expect(document.querySelector(`img[src^="data:image/jpeg"]`)).not.toBeNull());
    unmount();
    render(<ProfileView did={B.did} />);
    await screen.findByRole("heading", { level: 1, name: "Pebble" });
    expect(document.querySelector(`img[src^="data:image/jpeg"]`)).toBeNull();
  });

  it("friend buttons follow the relation", async () => {
    const base = [prof(A, "Lumen", 1), prof(B, "Pebble", 1), prof(C, "Kestrel", 1)];
    await load(base, null);
    const v = render(<ProfileView did={B.did} />);
    expect(await screen.findByRole("button", { name: "Make a profile to add friends" })).toBeInTheDocument();
    v.unmount();

    await load(base, A);
    let r = render(<ProfileView did={A.did} />);
    expect(await screen.findByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    r.unmount();
    r = render(<ProfileView did={B.did} />);
    expect(await screen.findByRole("button", { name: "Add friend" })).toBeInTheDocument();
    r.unmount();

    await load([...base, rec(B, "friend", { to: A.did }, 5)], A);
    r = render(<ProfileView did={B.did} />);
    expect(await screen.findByRole("button", { name: "Accept friend request" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Decline" }).length).toBe(1);
    r.unmount();

    await load([...base, rec(A, "friend", { to: C.did }, 5)], A);
    r = render(<ProfileView did={C.did} />);
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
    r.unmount();

    await load([...base, rec(A, "friend", { to: B.did }, 5), rec(B, "friend", { to: A.did }, 6)], A);
    r = render(<ProfileView did={B.did} />);
    expect(await screen.findByRole("button", { name: "Unfriend" })).toBeInTheDocument();
    noEmDash();
    r.unmount();

    await load([...base, rec(A, "friend", { to: B.did }, 5), rec(B, "friend", { to: A.did }, 6), rec(B, "unfriend", { to: A.did }, 7)], A);
    r = render(<ProfileView did={B.did} />);
    expect(await screen.findByText("Request sent")).toBeInTheDocument();
  });
});
