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
