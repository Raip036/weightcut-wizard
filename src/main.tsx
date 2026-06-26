import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { Capacitor } from "@capacitor/core";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import App from "./App.tsx";
import { convex } from "./integrations/convex/client";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

// Product analytics (PostHog). No-ops when VITE_POSTHOG_KEY is unset, so dev
// builds without a key are unaffected. Init at module-eval, before render, so
// the first $pageview (fired by RouteTracker on mount) is captured.
initAnalytics();

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
  // Tag <html> with `.native-app` SYNCHRONOUSLY at module-eval — before
  // createRoot().render() below — so the iOS-cheap CSS overrides in index.css
  // (stripping backdrop-filter / filter:blur on `.native-app …`) apply on the
  // very FIRST paint of every navigation. Previously this was added in an
  // App.tsx useEffect, which runs AFTER first paint, so heavy blurs flashed on
  // each page load before being stripped.
  document.documentElement.classList.add("native-app");

  Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});

  Keyboard.addListener("keyboardWillShow", (info) => {
    document.documentElement.style.setProperty(
      "--keyboard-inset",
      `${info.keyboardHeight}px`,
    );
    // Surface a boolean flag on <html> so CSS can hide the bottom-nav (and
    // any other tagged element) without needing the inset value itself.
    // Pairs with `[data-keyboard-open="true"] [data-hide-when-keyboard]`
    // in index.css.
    document.documentElement.dataset.keyboardOpen = "true";
  }).catch(() => {});

  Keyboard.addListener("keyboardWillHide", () => {
    document.documentElement.style.setProperty("--keyboard-inset", "0px");
    delete document.documentElement.dataset.keyboardOpen;
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
const CLEARANCE_PX = 24;              // breathing room above keyboard top

function scrollFocusedIntoView(el: HTMLElement) {
  // Measure the current keyboard inset (live, after keyboardWillShow has fired).
  const root = getComputedStyle(document.documentElement);
  const insetRaw = root.getPropertyValue("--keyboard-inset").trim() || "0px";
  const keyboardHeight = parseFloat(insetRaw) || 0;
  if (keyboardHeight === 0) return;  // no keyboard up — let browser handle

  const viewportHeight = window.innerHeight;
  const visibleAreaBottom = viewportHeight - keyboardHeight - CLEARANCE_PX;
  const rect = el.getBoundingClientRect();

  if (rect.bottom <= visibleAreaBottom) {
    return;  // already visible above the keyboard, no scroll needed
  }

  const scrollDelta = rect.bottom - visibleAreaBottom;

  // Walk up to find the nearest scrollable ancestor (overflow: auto/scroll).
  // If none found, fall back to window scroll.
  let container: Element | null = el.parentElement;
  while (container && container !== document.body) {
    const style = getComputedStyle(container);
    const overflowY = style.overflowY;
    const isScrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      container.scrollHeight > container.clientHeight;
    if (isScrollable) {
      container.scrollBy({ top: scrollDelta, behavior: "smooth" });
      return;
    }
    container = container.parentElement;
  }
  // Fallback: scroll window
  window.scrollBy({ top: scrollDelta, behavior: "smooth" });
}

document.addEventListener("focusin", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && !target.isContentEditable) return;
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    if (t === "hidden" || t === "checkbox" || t === "radio" || t === "file" || t === "submit" || t === "button" || t === "reset") {
      return;
    }
  }
  const el = target;
  window.setTimeout(() => {
    if (document.activeElement !== el) return;
    try {
      scrollFocusedIntoView(el);
    } catch {
      // best-effort
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
