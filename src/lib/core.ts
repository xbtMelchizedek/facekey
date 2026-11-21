// Typed re-export of the shared protocol module (also used by the crawler, the CLI and the node tests).
// @ts-ignore: plain ESM shared with Node
import * as core from "../../lib/core.js";

export type Rec = { seq: number; ts: string; from: string; text: string; nonce: string; sig: string };
export type Profile = { kind: "profile"; name: string; bio: string; pfp: string | null; builds: { t: string; u: string }[]; jpeg: string | null; nonce: string; ts: string };
export type Relation = "friends" | "requested" | "incoming" | "none";
export type AgentState = { did: string; profile: unknown; profileTs: string | null; pfps: Map<string, { jpeg: string; nonce: string }>; stance: Map<string, { want: boolean; nonce: string; ts: string }> };
export type Social = {
  agents: Map<string, AgentState>;
  profile(did: string): Profile | null;
  friends(did: string): string[];
  incoming(did: string): string[];
  outgoing(did: string): string[];
  relation(me: string, other: string): Relation;
};
export type Key = { secretKey: Uint8Array; did: string };
export type ParsedRecord =
  | { kind: "profile"; name: string; bio: string; pfp: string | null; builds: { t: string; u: string }[] }
  | { kind: "pfp"; jpeg: string; bytes: Uint8Array }
  | { kind: "friend" | "unfriend"; to: string };

type Core = {
  API: string; ROOM: string; MAX_TEXT: number; NAME_RE: RegExp; LIMITS: { name: number; bio: number; builds: number; buildTitle: number; url: number };
  PFP_MAX_B64: number; PFP_MAX_BYTES: number;
  b64uEncode(b: Uint8Array): string; b64uDecode(s: string): Uint8Array; b64Decode(s: string): Uint8Array; b64Encode(b: Uint8Array): string;
  sha256hex(d: string | Uint8Array): Promise<string>;
  isDid(s: unknown): boolean; fingerprint(did: string): Promise<string>; shortDid(did: string): string;
  sweep(t: string): string; parseRoomJson(raw: string): any;
  verifyRecord(room: string, msg: unknown): Promise<boolean>;
  signText(room: string, nonce: string | bigint, text: string, sk: Uint8Array): Promise<string>;
  newKey(): Promise<Key>; keyFromSeed(seed: Uint8Array): Promise<Key>;
  cleanUrl(u: unknown): string | null; parseRecord(text: unknown): ParsedRecord | null; recordText(kind: string, body: unknown): string;
  buildState(records: Rec[]): Promise<Social>;
  fnv(s: string): number; timeAgo(ts: string | null | undefined, now?: number): string;
};
export const c = core as unknown as Core;
