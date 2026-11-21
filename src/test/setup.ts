import "@testing-library/jest-dom/vitest";

// jsdom lacks these browser APIs that motion and the Arc tabs use.
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
const g = globalThis as Record<string, unknown>;
g.ResizeObserver ??= NoopObserver;
g.IntersectionObserver ??= NoopObserver;
if (!window.matchMedia) {
  window.matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList;
}
