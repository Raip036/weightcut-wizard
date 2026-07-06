/**
 * Runtime polyfills for older mobile WebViews. Imported FIRST in main.tsx so
 * these land before any bundled dependency code runs.
 *
 * `Array.prototype.at` / `String.prototype.at` (ES2022) are missing on iOS
 * Safari/WKWebView < 15.4 and Android System WebView < 92. A bundled dependency
 * calls `.at()`, which hard-crashes on those engines with
 * "this.o.at is not a function" (seen in production session replays). Vite's
 * build target transpiles syntax but never method calls, so a manual polyfill
 * is required.
 */
export {};

/* eslint-disable @typescript-eslint/no-explicit-any */
function at(this: any, index: number): any {
  const len = this.length >>> 0;
  let i = Math.trunc(index) || 0;
  if (i < 0) i += len;
  if (i < 0 || i >= len) return undefined;
  return this[i];
}

for (const Ctor of [Array, String]) {
  if (!(Ctor.prototype as any).at) {
    Object.defineProperty(Ctor.prototype, "at", {
      value: at,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}
