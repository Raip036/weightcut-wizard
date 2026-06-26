/**
 * Capture a single photo with the device camera.
 *
 * WHY THIS EXISTS: on native iOS (Capacitor / WKWebView) a raw
 * `<input type="file" capture="environment">` is unreliable — the camera
 * UI often returns no usable file (or zero-byte bytes the webview can't
 * read), so any upload that follows silently drops the media. Every media
 * surface that works (PostWorkoutMediaSheet via `SessionMediaPicker`, the
 * round-card FAB via `useRoundCardCapture`, the community `PostComposer`)
 * goes through the Capacitor Camera plugin instead. This helper centralises
 * that proven pattern so the manual training-calendar log form + the session
 * detail drawer can use the exact same path.
 *
 * Returns:
 *   - a `File` (JPEG) on a successful native capture,
 *   - `null` on web (caller should fall back to clicking an `<input capture>`),
 *   - `null` if the user cancels or denies the camera permission.
 *
 * The plugin returns a JPEG regardless of the device's native HEIC format,
 * which also sidesteps the HEIC-upload issues raw `<input>` selection hits.
 */
import { Capacitor } from "@capacitor/core";
import {
  Camera as CapCamera,
  CameraResultType,
  CameraSource,
} from "@capacitor/camera";

export async function captureCameraPhoto(): Promise<File | null> {
  // Web has no Capacitor bridge — let the caller fall back to its hidden
  // `<input type="file" capture>` which works fine in a real browser.
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const perms = await CapCamera.requestPermissions({
      permissions: ["camera"],
    });
    if (perms.camera === "denied") return null;

    const photo = await CapCamera.getPhoto({
      quality: 80,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      width: 1920,
      height: 1920,
    });

    if (!photo.webPath) return null; // cancelled / no path

    // The webview hands back a `file://` / `capacitor://` URL. On iOS
    // WKWebView fetch() can read it directly, but on Android the raw
    // `file://` URI is sandboxed and fetch() silently fails. Route it
    // through `Capacitor.convertFileSrc` so the WebView can read it on
    // BOTH platforms (no-op-equivalent on iOS) — then turn it into a real
    // File so the upload helper's MIME sniffing and size guard behave the
    // same as a picked file.
    const res = await fetch(Capacitor.convertFileSrc(photo.webPath));
    const blob = await res.blob();
    return new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
  } catch {
    // Cancellation / permission-denied throw on iOS — treat as a benign
    // no-op (no file captured).
    return null;
  }
}
