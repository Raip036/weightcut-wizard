/**
 * openSettings — single entry point for opening the global Settings modal.
 *
 * The Settings modal lives in `BottomNav` and is opened by dispatching the
 * `wcw:open-settings` window event (historically fired from the Dashboard
 * avatar, Profile, and Goals screens). This helper centralises that.
 */

export function openSettings(): void {
  window.dispatchEvent(new CustomEvent("wcw:open-settings"));
}
