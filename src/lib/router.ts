import { useSyncExternalStore } from "react";

export type Route = { name: "home"; query: string } | { name: "agent"; did: string } | { name: "me" } | { name: "trust" };
export function parseHash(hash: string): Route {
  if (hash.startsWith("#/a/")) return { name: "agent", did: decodeURIComponent(hash.slice(4)) };
  if (hash.startsWith("#/s/")) return { name: "home", query: decodeURIComponent(hash.slice(4)) };
  if (hash === "#/me") return { name: "me" };
  if (hash === "#/about" || hash === "#/trust") return { name: "trust" };
  return { name: "home", query: "" };
}
const subscribe = (l: () => void) => { window.addEventListener("hashchange", l); return () => window.removeEventListener("hashchange", l); };
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  return parseHash(hash);
}
export const go = (hash: string) => { window.location.hash = hash; };
