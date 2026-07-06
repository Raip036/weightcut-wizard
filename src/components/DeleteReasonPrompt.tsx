import IOSAlert from "@/components/ui/IOSAlert";

/**
 * Optional exit-reason picker shown as the very last tap before an account
 * is deleted — after both data-loss warnings, right before the destructive
 * call. Fixed choices only (no free-text, no PII). Skipping still proceeds
 * to delete; dismissing (backdrop) aborts. Rendered as an iOS-native alert
 * (stacked action list) to match the surrounding delete confirmations, in
 * the blue house style (all choices are default/blue, nothing red).
 *
 * Shared by the fighter (BottomNav) and coach (CoachSettingsSheet) delete
 * flows so the reason enum lives in exactly one place.
 */
export type DeleteReasonValue =
  | "too_expensive"
  | "not_using"
  | "missing_features"
  | "found_alternative"
  | "technical_issues"
  | "other";

const DELETE_REASONS: { value: DeleteReasonValue; label: string }[] = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "not_using", label: "Not using it" },
  { value: "missing_features", label: "Missing features I need" },
  { value: "found_alternative", label: "Found another app" },
  { value: "technical_issues", label: "Too many bugs or problems" },
  { value: "other", label: "Other" },
];

interface Props {
  open: boolean;
  /** True while the deletion is in flight; disables every button. */
  loading?: boolean;
  /** User picked a reason. Proceed to delete with this value. */
  onPick: (reason: DeleteReasonValue) => void;
  /** User tapped Skip. Proceed to delete with no reason ("not_given"). */
  onSkip: () => void;
  /** User tapped the backdrop. Abort deletion. */
  onDismiss: () => void;
}

export default function DeleteReasonPrompt({
  open,
  loading = false,
  onPick,
  onSkip,
  onDismiss,
}: Props) {
  return (
    <IOSAlert
      open={open}
      loading={loading}
      title="One last thing"
      message="Why are you leaving? This is optional and helps us improve."
      onBackdrop={onDismiss}
      actions={[
        ...DELETE_REASONS.map((r) => ({
          label: r.label,
          onPress: () => onPick(r.value),
        })),
        { label: "Skip", style: "cancel" as const, onPress: onSkip },
      ]}
    />
  );
}
