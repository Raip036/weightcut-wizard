import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * AgeGateBlock — App Store compliance hard-stop (17+).
 *
 * Rendered full-screen inside onboarding when a user whose entered age is a
 * real number below 17 attempts to continue past the age step. Weight cutting
 * involves dehydration and calorie restriction that isn't safe to guide for
 * under-17s, so there is NO path forward into plan generation from here.
 *
 * Two actions only:
 *  - "Go back": returns to the age step so the user can fix a typo
 *    (does NOT sign them out — a fat-fingered age shouldn't end the session).
 *  - "Sign out": calls the app's sign-out (UserContext `signOut`), mirroring
 *    how SettingsPanel signs the user out elsewhere.
 *
 * Standalone-renderable: pass `onGoBack` and `onSignOut` directly to mock it.
 */
export function AgeGateBlock({
  onGoBack,
  onSignOut,
}: {
  /** Return to the age step so the user can correct a mistyped age. */
  onGoBack: () => void;
  /** Sign the user out of the app entirely (no forward path). */
  onSignOut: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background dark:bg-[#020204]">
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center justify-center px-6 text-center"
        style={{
          paddingTop: "max(env(safe-area-inset-top, 0px), 1.5rem)",
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 1.5rem)",
        }}
      >
        <div className="w-full max-w-sm space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-func-danger-red/30 bg-func-danger-red/10">
            <ShieldAlert className="h-7 w-7 text-func-danger-red" />
          </div>

          <div className="space-y-2.5">
            <h1 className="text-[20px] font-bold leading-tight text-foreground">
              FightCamp Wizard is for athletes 17 and older
            </h1>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Weight cutting involves dehydration and calorie restriction that
              isn't safe to guide for anyone under 17. We can't build a plan for
              you right now.
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground/80">
              If you entered the wrong age by mistake, go back and fix it.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <Button
              onClick={onGoBack}
              className="no-tap-select w-full h-11 rounded-2xl bg-primary text-primary-foreground hover:opacity-90"
            >
              Go back
            </Button>
            <Button
              onClick={onSignOut}
              variant="outline"
              className="no-tap-select w-full h-11 rounded-2xl border-border/50 bg-card text-foreground hover:bg-muted/30"
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
