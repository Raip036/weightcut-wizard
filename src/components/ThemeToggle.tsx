/* Design System v1 is dark-only. The toggle UI is retired but the export
   is kept so existing imports in App.tsx, BottomNav.tsx, and
   CoachSettingsSheet.tsx continue to compile. Renders nothing. Delete the
   component and its three call sites in a follow-up cleanup PR. */
export function ThemeToggle(_props: { className?: string }) {
  return null;
}
