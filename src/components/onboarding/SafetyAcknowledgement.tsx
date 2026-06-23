import { Checkbox } from "@/components/ui/checkbox";
import { ShieldCheck } from "lucide-react";

/**
 * SafetyAcknowledgement — App Store compliance gate.
 *
 * A required acknowledgement the user must actively confirm BEFORE the very
 * first plan generates. Weight-cut guidance is educational only (not medical
 * advice), so we make the user tick this before the "Generate plan" / commit
 * action unblocks.
 *
 * Stateless: the parent owns the `checked` boolean and gates its
 * continue/generate action on it. Standalone-renderable for mockups by passing
 * `checked` + `onCheckedChange`.
 */
export function SafetyAcknowledgement({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  const toggle = () => onCheckedChange(!checked);
  return (
    // role="checkbox" on a div (not a <button>) so the visual Checkbox inside
    // — which Radix renders as its own <button> — isn't nested in a button,
    // which is invalid DOM. The whole card stays tappable + keyboard operable.
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      }}
      className={`w-full flex items-start gap-2.5 rounded-2xl border p-3 text-left transition-all cursor-pointer active:scale-[0.99] ${
        checked
          ? "border-primary/50 bg-primary/[0.06]"
          : "border-border/50 bg-card"
      }`}
    >
      <Checkbox
        checked={checked}
        // Presentational only — the wrapping card handles the tap, so keep the
        // indicator in sync but non-interactive to avoid double-toggling.
        aria-hidden
        tabIndex={-1}
        className="mt-px h-4 w-4 flex-shrink-0 pointer-events-none"
      />
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-[12px] font-semibold text-primary/90">
            Before we build your plan
          </span>
        </div>
        <p className="text-[12px] leading-snug text-foreground/85">
          I understand FightCamp Wizard provides educational guidance only, not
          medical advice, and I should consult a physician or sports dietitian
          before cutting weight.
        </p>
      </div>
    </div>
  );
}
