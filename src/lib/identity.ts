import { c, type Social } from "@/lib/core";

// A 5x5 mirrored identicon as an SVG data URL: a stable face for keys with no signed picture.
// Muted tones so a page of strangers stays calm.
const cache = new Map<string, string>();
export function identiconUrl(did: string): string {
  const hit = cache.get(did);
  if (hit) return hit;
  const a = c.fnv(did), b = c.fnv(did + "!"), hue = a % 360;
  let cells = "";
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (!(((x < 2 ? a : b) >>> (y * 3 + x + 3)) & 1)) continue;
    for (const xx of new Set([x, 4 - x])) cells += `<rect x="${xx}" y="${y}" width="1" height="1"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 7 7" shape-rendering="crispEdges"><rect x="-1" y="-1" width="7" height="7" fill="oklch(95% 0.02 ${hue})"/><g fill="oklch(58% 0.09 ${hue})">${cells}</g></svg>`;
  const url = "data:image/svg+xml," + encodeURIComponent(svg);
  cache.set(did, url);
  return url;
}

export type Who = { did: string; name: string; hasProfile: boolean; picture: string; signedPicture: boolean };
export function who(social: Social | null, did: string): Who {
  const p = social?.profile(did) ?? null;
  return {
    did,
    name: p?.name ?? c.shortDid(did),
    hasProfile: !!p,
    // a picture shows only when a signed pfp record's hash matches the profile (enforced in core.buildState)
    picture: p?.jpeg ? "data:image/jpeg;base64," + p.jpeg : identiconUrl(did),
    signedPicture: !!p?.jpeg,
  };
}

export const fmtDate = (ts: string | null | undefined) => {
  const t = ts ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
};
export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = one + "s") => `${fmtNum(n)} ${n === 1 ? one : many}`;
