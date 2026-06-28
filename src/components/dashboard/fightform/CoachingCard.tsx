import { useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";
import { SUBSCORE_LABEL } from "@/components/dashboard/fightform/constants";
import {
  useFightFormCoach,
  type FightFormCoachContext,
} from "@/hooks/dashboard/useFightFormCoach";
import wizard from "@/assets/wizard_3D.png";

const BLUE = "217 91% 58%";
const blue = (a = 1) => `hsl(${BLUE} / ${a})`;

/** Capitalise the first letter so AI prose never starts lower-case. */
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Premium "Aurora Wizard" idle teaser for the Fight Form coach.
 *
 * A self-contained blue, wizard-mascot card shown before the user has
 * generated a read — replaces the old flat glass-card teaser with the sparkle
 * iconography. The 3D wizard floats in a breathing blue halo over a rising
 * aurora wash with a few drifting motes; the CTA is a glowing blue pill, no
 * icons. Matches the app's reference loading aesthetic (ProtocolGenerating
 * Overlay / reference_aurora_wizard_loader). All motion is transform/opacity
 * only and collapses to a calm static state under reduced-motion.
 *
 * Presentational on purpose (no hooks beyond motion) so the preview lab can
 * render it without the Convex-backed `useFightFormCoach` context.
 */
export function CoachReadIdleCard({
  isPro,
  loading = false,
  onRun,
  className,
}: {
  isPro: boolean;
  loading?: boolean;
  onRun: () => void;
  className?: string;
}) {
  const prefersReduced = useReducedMotion();

  // Deterministic drifting motes (index-based, no Math.random in render).
  const motes = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        id: i,
        x: ((i * 53) % 200) - 100,
        delay: (i % 4) * 0.7,
        dur: 6 + (i % 3),
        size: 3 + (i % 3),
      })),
    [],
  );

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={cn(
        "mt-6 relative overflow-hidden rounded-2xl border border-primary/25 px-5 pt-5 pb-5",
        className,
      )}
      style={{
        background:
          "linear-gradient(165deg, hsl(217 55% 13% / 0.55) 0%, hsl(222 47% 7% / 0.7) 60%)",
      }}
    >
      {/* Aurora wash rising from the base. */}
      <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(120% 75% at 50% 100%, ${blue(0.3)}, transparent 70%)`,
        }}
        animate={
          prefersReduced ? { opacity: 0.7 } : { opacity: [0.55, 0.9, 0.55], scale: [1, 1.05, 1] }
        }
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Rising blue motes. */}
      {!prefersReduced &&
        motes.map((m) => (
          <motion.span
            key={m.id}
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: `calc(50% + ${m.x}px)`,
              bottom: 0,
              width: m.size,
              height: m.size,
              background: blue(0.7),
              boxShadow: `0 0 6px ${blue(0.9)}`,
            }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: -140, opacity: [0, 1, 0] }}
            transition={{ duration: m.dur, repeat: Infinity, ease: "easeOut", delay: m.delay }}
          />
        ))}

      <div className="relative z-10 flex flex-col items-center text-center">
        {/* Haloed, bobbing wizard mascot. */}
        <div className="relative flex items-center justify-center" style={{ height: 68 }}>
          {!prefersReduced && (
            <motion.div
              aria-hidden
              className="absolute"
              style={{
                width: 90,
                height: 90,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${blue(0.45)} 0%, ${blue(0.12)} 42%, transparent 70%)`,
                filter: "blur(6px)",
              }}
              animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.07, 0.95] }}
              transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          <motion.img
            src={wizard}
            alt=""
            draggable={false}
            style={{
              width: 64,
              height: 64,
              objectFit: "contain",
              position: "relative",
              zIndex: 2,
              filter: `drop-shadow(0 0 14px ${blue(0.4)})`,
            }}
            animate={prefersReduced ? { y: 0 } : { y: [0, -6, 0] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="mt-1.5 flex items-center justify-center gap-1.5">
          <span className="text-body font-semibold text-foreground">Coach's read</span>
          {!isPro && (
            <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">
              Pro
            </span>
          )}
        </div>

        <p className="mt-1 text-body-sm text-muted-foreground leading-snug max-w-[15rem]">
          {isPro
            ? "A holistic read on your camp and what to fix next."
            : "Unlock a holistic read on your camp and what to fix next."}
        </p>

        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          className={cn(
            "mt-4 w-full rounded-xl px-4 py-2.5 text-body-sm font-semibold text-white",
            "active:scale-[0.99] transition-transform disabled:opacity-60",
          )}
          style={{
            background: `linear-gradient(180deg, ${blue(1)}, ${blue(0.82)})`,
            boxShadow: `0 6px 20px ${blue(0.35)}`,
          }}
        >
          {isPro ? "Get AI coaching" : "Unlock AI coaching"}
        </button>
      </div>
    </motion.div>
  );
}

interface Props {
  /** Deterministic score context, built by the sheet. */
  context: FightFormCoachContext;
  /** Optional deep-link for action items. */
  onNavigate?: (route: string) => void;
}

/**
 * Sheet-level holistic "AI coaching" card for the Fight Form score.
 *
 * Owns the `useFightFormCoach` hook end-to-end, the parent sheet only
 * supplies the deterministic `context` it already computes. Renders four
 * states off the hook:
 *
 *   - IDLE    → compact "Coach's read" teaser + primary CTA. Pro users see
 *               "Get AI coaching"; free users see "Unlock AI coaching" and
 *               tapping routes through the app's standard paywall (the hook's
 *               `useAIAction` opens the paywall upfront for non-pro callers).
 *   - LOADING → spinner + "Reading your camp…", CTA disabled.
 *   - LOADED  → `summary` as the headline, `actions` as a tidy pillar list,
 *               plus a subtle Refresh affordance (cached 24h/day, cheap).
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
    // and don't call generate if not pro, keeps the error row pro-only.
    void generate(context);
  };

  const reveal = prefersReduced
    ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.35, ease: "easeOut" as const },
      };

  // Before a read exists (and outside the loading/error flow), show the
  // premium aurora-wizard teaser instead of the flat glass header card.
  const isIdle = !coaching && !loading && !(error && isPro);
  if (isIdle) {
    return <CoachReadIdleCard isPro={isPro} loading={loading} onRun={run} />;
  }

  return (
    <div className="mt-6 glass-card rounded-2xl border border-border/50 px-4 py-4">
      <div className="flex items-center gap-2.5">
        {/* Wizard mascot, no tinted circle behind it. */}
        <img
          src={wizard}
          alt=""
          draggable={false}
          className="h-8 w-8 object-contain shrink-0"
        />
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
            {/* Derivation, why the score is what it is, in real points.
                Falls back to plain `summary` when the prose fallback path ran. */}
            {coaching.derivation ? (
              <p className="text-body-sm text-foreground font-medium leading-snug">
                {coaching.derivation}
              </p>
            ) : coaching.summary ? (
              <p className="text-body-sm text-foreground/90 leading-snug">
                {coaching.summary}
              </p>
            ) : null}

            {/* What's working vs what's limiting. No leading icons; the colored
                label carries the meaning. */}
            {(coaching.working || coaching.limiting) && (
              <div className="space-y-1.5">
                {coaching.working && (
                  <p className="text-[12px] text-foreground/90 leading-snug">
                    <span className="font-semibold text-func-recovery-green">
                      Working.{" "}
                    </span>
                    {coaching.working}
                  </p>
                )}
                {coaching.limiting && (
                  <p className="text-[12px] text-foreground/90 leading-snug">
                    <span className="font-semibold text-func-danger-red">
                      Limiting.{" "}
                    </span>
                    {coaching.limiting}
                  </p>
                )}
              </div>
            )}

            {/* Ranked fixes, biggest point gain first, each with its payoff. */}
            {coaching.actions.length > 0 && (
              <ul className="space-y-2">
                {coaching.actions.map((a, i) => {
                  const pillarLabel = SUBSCORE_LABEL[a.pillar] ?? a.pillar;
                  return (
                    <li
                      key={`${a.pillar}-${i}`}
                      className="rounded-2xl border border-border/40 bg-white/[0.02] px-4 py-3"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {i === 0 && (
                          <span className="text-[10px] font-bold tracking-wide text-primary bg-primary/15 rounded-md px-1.5 py-0.5">
                            Fix First
                          </span>
                        )}
                        <span className="text-[12px] font-semibold text-foreground/70">
                          {pillarLabel}
                        </span>
                        {typeof a.pointsToGain === "number" && a.pointsToGain > 0 && (
                          <span className="ml-auto text-[12px] font-bold tabular-nums text-primary shrink-0">
                            +{a.pointsToGain} pts
                          </span>
                        )}
                      </div>
                      <span className="block text-[14px] text-foreground/90 leading-snug">
                        {capFirst(a.action)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Active ceiling, a rule is capping the score. */}
            {coaching.ceiling && (
              <div className="flex items-start gap-2 rounded-2xl border border-func-warning-yellow/30 bg-func-warning-yellow/10 px-4 py-3">
                <Icon
                  name="alertCircleOutline"
                  size={15}
                  className="text-func-warning-yellow shrink-0 mt-px"
                />
                <p className="text-[12px] text-foreground/90 leading-snug">
                  {coaching.ceiling}
                </p>
              </div>
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
        ) : null}
      </AnimatePresence>
    </div>
  );
}
