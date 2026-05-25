import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import App from "./App.tsx";
import { convex } from "./integrations/convex/client";
import "./index.css";

// ---------------------------------------------------------------------------
// iOS keyboard behavior
// ---------------------------------------------------------------------------
// `capacitor.config.ts` already sets `Keyboard.resize: "none"` so the
// WKWebView is NOT resized when the keyboard opens — without this, every
// `dvh`/`vh`-sized element (full-height bottom sheets, the polaroid, etc.)
// shifts when the keyboard slides up, producing flicker and re-introducing
// scroll on previously fixed-height layouts.
//
// We reinforce that mode imperatively at boot (defensive in case a future
// plugin or runtime override flips it), and mirror the keyboard height into
// `--keyboard-inset` on `:root` so `.keyboard-aware-bottom` (and any other
// consumer) can reserve room while the keyboard is visible. Capacitor
// exposes `env(keyboard-inset-height)` on newer iOS but the listener is
// the portable fallback for older versions.
//
// DO NOT add `Keyboard.setScroll({ isDisabled: true })` here. That flag
// disables WKWebView scrolling entirely (not just the focus jump), which
// killed vertical scroll on every page of the app. The "scroll returns
// when keyboard closes" twitch is already handled by `resize: "none"`
// alone — there's nothing further to disable.
if (Capacitor.isNativePlatform()) {
  Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});

  Keyboard.addListener("keyboardWillShow", (info) => {
    document.documentElement.style.setProperty(
      "--keyboard-inset",
      `${info.keyboardHeight}px`,
    );
  }).catch(() => {});

  Keyboard.addListener("keyboardWillHide", () => {
    document.documentElement.style.setProperty("--keyboard-inset", "0px");
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Universal "focused input scrolls into view" handler
// ---------------------------------------------------------------------------
// Because Capacitor's resize mode is `none`, the WebView doesn't shrink when
// the keyboard appears — inputs at the bottom of a Dialog/Sheet/page can end
// up sitting underneath the keyboard with no automatic recovery.
//
// We attach ONE delegated `focusin` listener on the document so every
// `<input>`, `<textarea>`, and `contenteditable` surface in the app (shadcn
// or native, present or future) is scrolled into the centre of its scroll
// container after the keyboard slide-in completes (~250ms on iOS). The
// document-level listener replaces the per-callsite `useScrollIntoViewOnFocus`
// wiring — existing call-sites can stay, they're idempotent.
//
// The 320ms timeout matches the iOS keyboard animation + a small buffer so
// the inset on `:root` has been written before we measure positions.
const KEYBOARD_FOCUS_DELAY_MS = 320;
document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && !target.isContentEditable) return;
  // `type="hidden"` / `type="checkbox"` / `type="radio"` / `type="file"` etc.
  // don't pop the keyboard; skip the scroll cost.
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    if (t === "hidden" || t === "checkbox" || t === "radio" || t === "file" || t === "submit" || t === "button" || t === "reset") {
      return;
    }
  }
  const el = target;
  window.setTimeout(() => {
    // Re-check that the field is still the active one — the user may have
    // tabbed away or dismissed the keyboard during the delay window.
    if (document.activeElement !== el) return;
    try {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Older WebKit can throw on smooth-scroll with detached nodes — best-effort.
    }
  }, KEYBOARD_FOCUS_DELAY_MS);
});

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.2,
    sendDefaultPii: false,
    ignoreErrors: [
      "ResizeObserver loop",
      "AbortError",
      "Failed to fetch",
      "Load failed",
      "NetworkError",
      "timed out after",
      "Authentication operation timed out",
      "useAuth must be used within",
      "useProfile must be used within",
      "Cannot access uninitialized variable",
    ],
  });
}

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  if (dsn) {
    Sentry.captureException(event.reason);
  }
});

createRoot(document.getElementById("root")!).render(
  <ConvexAuthProvider client={convex}>
    <App />
  </ConvexAuthProvider>
);
