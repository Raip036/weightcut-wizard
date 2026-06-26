import type { CapacitorConfig } from '@capacitor/cli';

// When CAP_DEV_URL is set (e.g. "http://localhost:5173"), the iOS app loads
// from the Vite dev server instead of the bundled dist/. This gives instant
// hot-reload in the simulator without needing a full build + Xcode rebuild.
//
// Workflow:
//   Development  → npm run dev:ios   (sets CAP_DEV_URL, syncs once)
//                  npm run dev       (starts Vite dev server on :5173)
//                  Run from Xcode   → changes appear immediately on save
//
//   Production   → npm run sync:ios  (builds dist, syncs, NO server URL)
//                  Run from Xcode
const devUrl = process.env.CAP_DEV_URL;

const config: CapacitorConfig = {
  appId: 'com.weightcutwizard.app',
  appName: 'FightCamp Wizard',
  webDir: 'dist',
  ios: {
    preferredContentMode: 'mobile',
    allowsLinkPreview: false,
  },
  // No `android: {}` block is needed: Android uses the shared config below.
  // `server.androidScheme: 'https'` and the `Keyboard` plugin config are
  // cross-platform, and the `ios` keys above are iOS-only (Capacitor ignores
  // them on Android), so there are no iOS-only keys to strip out for Android.
  // Native Android capabilities (camera, push, media, deep links) are declared
  // in android/app/src/main/AndroidManifest.xml, not here.
  server: {
    ...(devUrl ? { url: devUrl, cleartext: true } : {}),
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    // Keep the WKWebView the same size when the iOS keyboard opens. The
    // default `native` mode shrinks the webview, which shifts every absolutely
    // positioned/`dvh`-sized element on the page (full-height sheets, the
    // BottomNav, the polaroid in Round Card), producing visible flicker and
    // re-introducing scroll on layouts that were previously fixed-height.
    //
    // With `resize: "none"` the keyboard floats over the bottom of the
    // viewport instead. Focused inputs are kept visible by:
    //   1. Capacitor's `keyboardWillShow` listener (see src/main.tsx),
    //      which mirrors the keyboard height into a CSS custom property
    //      `--keyboard-inset` on `:root`.
    //   2. The `.keyboard-aware-bottom` utility in src/index.css, which
    //      reserves bottom padding equal to `max(safe-area, --keyboard-inset)`.
    //   3. `setScroll({ isDisabled: true })` in src/main.tsx, which kills
    //      WKWebView's built-in scroll-into-view jump that contributes to
    //      the flicker.
    Keyboard: {
      resize: 'none',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
