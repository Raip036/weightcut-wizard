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
// plugin or runtime override flips it) and:
//   - Disable WKWebView's built-in scroll-into-view jump on focus
//     (`setScroll({ isDisabled: true })`). Combined with `resize: none`,
//     this stops the page from twitching when an input is tapped.
//   - Mirror the keyboard height into `--keyboard-inset` on `:root`, which
//     `.keyboard-aware-bottom` (and any other consumer) can use as the
//     bottom inset while the keyboard is visible. Capacitor exposes
//     `env(keyboard-inset-height)` on newer iOS but the listener is the
//     portable fallback for older versions.
if (Capacitor.isNativePlatform()) {
  Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(() => {});
  Keyboard.setScroll({ isDisabled: true }).catch(() => {});

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
