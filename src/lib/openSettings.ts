/**
 * openSettings — single entry point for opening the global Settings modal.
 *
 * The Settings modal lives in `BottomNav` and is opened by dispatching the
 * `wcw:open-settings` window event (historically fired from the Dashboard
 * avatar, Profile, and Goals screens). This helper centralises that and adds
 * an optional `focus` payload so a caller can deep-link the user straight to a
 * sub-section — e.g. "Connect Apple Health" prompts elsewhere in the app open
 * Settings focused on the Apple Health entry.
 *
 * Listener: `BottomNav` reads `(e as CustomEvent).detail?.focus` and forwards
 * it to `SettingsPanel` via the `focus` prop.
 */

/** Sub-sections of the Settings modal a caller can deep-link to. */
export type SettingsFocus = "apple-health";

export function openSettings(focus?: SettingsFocus): void {
  window.dispatchEvent(
    new CustomEvent("wcw:open-settings", {
      detail: focus ? { focus } : undefined,
    }),
  );
}
