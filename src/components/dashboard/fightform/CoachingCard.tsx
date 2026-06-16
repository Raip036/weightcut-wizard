import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";
import { SUBSCORE_LABEL } from "@/components/dashboard/fightform/constants";
import {
  useFightFormCoach,
  type FightFormCoachContext,
} from "@/hooks/dashboard/useFightFormCoach";

interface Props {
  /** Deterministic score context, built by the sheet. */
  context: FightFormCoachContext;
  /** Optional deep-link for action items. */
  onNavigate?: (route: string) => void;
}

/**
 * Sheet-level holistic "AI coaching" card for the Fight Form score.
 *
 * Owns the `useFightFormCoach` hook end-to-end — the parent sheet only
 * supplies the deterministic `context` it already computes. Renders four
 * states off the hook:
 *
 *   - IDLE    → compact "Coach's read" teaser + primary CTA. Pro users see
 *               "Get AI coaching"; free users see "Unlock AI coaching" and
 *               tapping routes through the app's standard paywall (the hook's
 *               `useAIAction` opens the paywall upfront for non-pro callers).
 *   - LOADING → spinner + "Reading your camp…", CTA disabled.
 *   - LOADED  → `summary` as the headline, `actions` as a tidy pillar list,
 *               plus a subtle Refresh affordance (cached 24h/day — cheap).
 *   - ERROR   → inline "Couldn't reach the coach" + retry.
 *
 * All reveals are transform/opacity-only so the animation stays cheap on
 * device (matches the dashboard's native-app perf gating).
 */
export function CoachingCard({ context, onNavigate }: Props) {
  const { coaching, loading, error, isPro, generate } = useFightFormCoach();
  const prefersReduced = useReducedMotion();

  // `onNavigate` is part of the public API for action deep-links, but the
  // coach currently returns prose-only actions ({ pillar, action }) with no
  // route, so there is nothing to navigate to yet. Reference it so the prop
  // stays wired for when action routes land, without an unused-var warning.
  void onNavigate;

  const run = () => {
    triggerHapticSelection();
    // For non-pro users `generate` → `useAIAction` opens the paywall upfront
    // and rejects with PRO_FEATURE_REQUIRED; the hook swallows that into its
    // `error` state. We surface the paywall as the affordance (button label)
    // and don't call generate if not pro — keeps the error row pro-only.
    void generate(context);
  };

  const reveal = prefersReduced
    ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  return (
    <div className="mt-6 glass-card rounded-2xl border border-border/50 px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Icon
            name={isPro ? "sparklesOutline" : "lockClosedOutline"}
            size={16}
            className={isPro ? "text-primary" : "text-muted-foreground"}
          />
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-body-sm font-semibold truncate">Coach's read</span>
          {!isPro && (
            <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">
              Pro
            </span>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {coaching ? (
          <motion.div
            key="loaded"
            {...reveal}
            className="mt-3 space-y-3"
          >
            <p className="text-body-sm text-foreground/90 leading-snug">
              {coaching.summary}
            </p>

            {coaching.actions.length > 0 && (
              <ul className="space-y-1.5">
                {coaching.actions.map((a, i) => {
                  const pillarLabel = SUBSCORE_LABEL[a.pillar] ?? a.pillar;
                  return (
                    <li
                      key={`${a.pillar}-${i}`}
                      className="flex items-start gap-2.5 rounded-xs border border-border/40 bg-muted/15 px-3 py-2.5"
                    >
                      <Icon
                        name="arrowForwardOutline"
                        size={14}
                        className="text-primary shrink-0 mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/80">
                          {pillarLabel}
                        </span>
                        <span className="block text-body-sm text-foreground/90 leading-snug">
                          {a.action}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={run}
              disabled={loading}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground active:text-foreground transition-colors disabled:opacity-50"
            >
              <Icon
                name="refreshOutline"
                size={12}
                className={cn("shrink-0", loading && "animate-spin")}
              />
              <span>{loading ? "Refreshing…" : "Refresh"}</span>
            </button>
          </motion.div>
        ) : loading ? (
          <motion.div
            key="loading"
            {...reveal}
            className="mt-3 flex items-center gap-2.5"
          >
            <span
              className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin shrink-0"
              aria-hidden
            />
            <span className="text-body-sm text-muted-foreground">
              Reading your camp…
            </span>
          </motion.div>
        ) : error && isPro ? (
          <motion.div key="error" {...reveal} className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-body-sm text-muted-foreground">
              <Icon
                name="alertCircleOutline"
                size={14}
                className="text-func-warning-yellow shrink-0"
              />
              <span>Couldn't reach the coach, try again.</span>
            </div>
            <button
              type="button"
              onClick={run}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-primary active:opacity-70 transition-opacity"
            >
              <Icon name="reloadOutline" size={12} className="shrink-0" />
              <span>Retry</span>
            </button>
          </motion.div>
        ) : (
          <motion.div key="idle" {...reveal} className="mt-3 space-y-3">
            <p className="text-body-sm text-muted-foreground leading-snug">
              {isPro
                ? "A holistic read on your camp — what's working, and the few things to fix next."
                : "Unlock a holistic read on your camp — what's working, and the few things to fix next."}
            </p>
            <button
              type="button"
              onClick={run}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5",
                "text-body-sm font-semibold active:scale-[0.99] transition-transform",
                isPro
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/15 text-primary ring-1 ring-primary/25",
              )}
            >
              <Icon
                name={isPro ? "sparklesOutline" : "lockClosedOutline"}
                size={15}
                className="shrink-0"
              />
              <span>{isPro ? "Get AI coaching" : "Unlock AI coaching"}</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
