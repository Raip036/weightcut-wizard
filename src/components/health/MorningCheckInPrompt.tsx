/**
 * MorningCheckInPrompt — Tier 0/1 banner on the Recovery page.
 *
 * Rendered when the user has no (or too little) HealthKit data so the
 * score engine falls back to the self-report path. Tapping the banner
 * opens a bottom sheet containing the existing `WellnessCheckIn`
 * component — re-used as-is per spec §3.3.
 */

import { useCallback, useState } from "react";
import { motion } from "motion/react";
import { Brain, ChevronRight, Sunrise } from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { WellnessCheckIn } from "@/components/fightcamp/WellnessCheckIn";
import type { WellnessCheckIn as WellnessCheckInData } from "@/utils/performanceEngine";
import ErrorBoundary from "@/components/ErrorBoundary";

interface MorningCheckInPromptProps {
  userId: string;
  /** Optional callback invoked after the in-sheet check-in submits. */
  onCheckedIn?: (data: WellnessCheckInData) => void;
  className?: string;
}

// The morning wellness check-in is FREE — it feeds the fight-form-score ring
// that free users keep. No Pro gate here; only the Recovery dashboard + AI
// coaching extras are gated.
export function MorningCheckInPrompt(
  props: MorningCheckInPromptProps,
): JSX.Element {
  // Defensive wrapper — the inner check-in flow renders WellnessCheckIn,
  // which has its own Convex hooks. A failure there shouldn't crash the
  // Recovery page; show a small inline fallback instead.
  return (
    <ErrorBoundary
      fallback={<MorningCheckInErrorFallback className={props.className} />}
    >
      <MorningCheckInPromptInner {...props} />
    </ErrorBoundary>
  );
}

function MorningCheckInPromptInner({
  userId,
  onCheckedIn,
  className,
}: MorningCheckInPromptProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    (data: WellnessCheckInData) => {
      // WellnessCheckIn writes to Convex internally; here we just close
      // the sheet and bubble the data up so the page can refresh its
      // score / recovery view.
      setSubmitting(false);
      setOpen(false);
      onCheckedIn?.(data);
    },
    [onCheckedIn],
  );

  // Mark `userId` as referenced for the prop API even though the inner
  // WellnessCheckIn derives it from Convex auth — the prop is kept so
  // callers don't have to change later if we go back to a passed value.
  void userId;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
        className={className}
      >
        <Card
          onClick={() => setOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "cursor-pointer rounded-xs card-surface p-4",
            "active:scale-[0.99] transition-transform",
          )}
          aria-label="Open morning check-in"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs border border-border/50 bg-background/60">
              <Sunrise
                className="h-5 w-5 text-func-warning-yellow"
                strokeWidth={2.2}
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Morning check-in
              </p>
              <p className="mt-0.5 text-[13.5px] font-semibold leading-tight text-foreground">
                Complete today's check-in
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Two taps — your readiness score updates instantly.
              </p>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </div>
        </Card>
      </motion.div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="h-[88dvh] rounded-t-2xl border-border/50 bg-background p-4"
        >
          <SheetHeader className="pb-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-[18px]">
              <Brain className="h-4 w-4 text-primary" />
              Morning check-in
            </SheetTitle>
            <SheetDescription className="text-[12px]">
              How are you today? Four quick taps powers your recovery score.
            </SheetDescription>
          </SheetHeader>
          <WellnessCheckIn
            userId={userId}
            onSubmit={(data) => {
              setSubmitting(true);
              handleSubmit(data);
            }}
            isSubmitting={submitting}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function MorningCheckInErrorFallback({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <Card
      className={cn(
        "rounded-xs card-surface p-4",
        className,
      )}
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xs border border-border/50 bg-background/60">
          <Sunrise
            className="h-5 w-5 text-func-warning-yellow"
            strokeWidth={2.2}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-tight text-foreground">
            Morning check-in unavailable
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Couldn't load health data — pull to refresh.
          </p>
        </div>
      </div>
    </Card>
  );
}
