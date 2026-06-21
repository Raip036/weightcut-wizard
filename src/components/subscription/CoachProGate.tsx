import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ShimmerCrownBadge } from "./ShimmerCrownBadge";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { staggerContainer, staggerItem, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * CoachProGate
 *
 * The in-sheet sell screen shown to FREE users who open the Fight Camp Coach.
 * Free users are SOLD on Pro here, not allowed to chat. It mirrors the visual
 * recipe of `PaywallOverlay` / `ContextualCoachPaywall` (shimmer crown, gradient
 * CTA `from-primary to-secondary`, card surfaces, copy tone) so it reads as a
 * sibling of the app's other paywall surfaces.
 *
 * It owns NO purchase / trial logic: the primary CTA hands off to the existing
 * RevenueCat flow via `openPaywall()`, which surfaces its own 7-day free trial.
 */

const PRO_REASONS: { icon: IonIconName; title: string; sub: string }[] = [
  {
    icon: "chatbubblesOutline",
    title: "24/7 interactive cornerman",
    sub: "Ask why, what now, anytime. Answers from your real data.",
  },
  {
    icon: "flashOutline",
    title: "Personalized fight-week cut & rehydration",
    sub: "A protocol that adjusts to your weight, days out and load.",
  },
  {
    icon: "listOutline",
    title: "Structured plans, charts & checklists",
    sub: "Daily targets and step-by-step protocols, not vague tips.",
  },
  {
    icon: "pulseOutline",
    title: "Insights on demand",
    sub: "Training, nutrition, recovery & fight-score reads when you ask.",
  },
  {
    icon: "statsChartOutline",
    title: "Multi-camp history & trends",
    sub: "Track every cut and see what's working, camp over camp.",
  },
  {
    icon: "calendarOutline",
    title: "Off-season planning",
    sub: "Stay fight-ready and walk into your next camp ahead.",
  },
];

/** Fixed mote positions so particles don't re-randomise each render. This is the
 *  same drifting-blue-particle field the Recovery Pro gate (ProUpsellScreen) uses. */
const MOTES: Array<{ left: string; size: number; dur: number; delay: number }> = [
  { left: "6%", size: 4, dur: 7.5, delay: 0.0 },
  { left: "17%", size: 3, dur: 9.0, delay: 1.6 },
  { left: "28%", size: 5, dur: 8.0, delay: 0.7 },
  { left: "39%", size: 3, dur: 9.5, delay: 2.4 },
  { left: "50%", size: 4, dur: 8.3, delay: 1.1 },
  { left: "61%", size: 3, dur: 9.1, delay: 0.4 },
  { left: "72%", size: 5, dur: 7.8, delay: 2.0 },
  { left: "83%", size: 3, dur: 9.3, delay: 1.0 },
  { left: "93%", size: 4, dur: 8.6, delay: 0.5 },
];

/** Build the contextual hook line from the live briefing, or a generic fallback. */
function buildHook(
  briefing:
    | { deltaKg: number | null; daysToWeighIn: number | null; priorityAction: string | null }
    | null
    | undefined,
): string {
  const over = briefing?.deltaKg;
  const days = briefing?.daysToWeighIn;
  if (typeof over === "number" && over > 0.1 && typeof days === "number" && days >= 0) {
    const kg = Math.round(over * 10) / 10;
    const dayLabel = days === 0 ? "weigh-in day" : `${days} day${days === 1 ? "" : "s"} left`;
    return `You're ${kg}kg over with ${dayLabel}. Your cornerman has a plan.`;
  }
  if (briefing?.priorityAction) {
    return `${briefing.priorityAction}. Your cornerman can take it from here.`;
  }
  return "Your fight camp, dialed in. Every day of camp, in your corner.";
}

export function CoachProGate({ className }: { className?: string }): JSX.Element {
  const prefersReduced = useReducedMotion();
  const briefing = useQuery(api.coachBriefing.getBriefing, {});
  const { openPaywall } = useSubscription();
  const { toast } = useToast();

  const hook = buildHook(briefing);

  const handleUnlock = () => {
    triggerHaptic();
    // Hand off to the EXISTING RevenueCat paywall / purchase flow. The native
    // RevenueCat paywall surfaces its own 7-day free trial; we never build one.
    try {
      openPaywall();
    } catch {
      toast({
        title: "Couldn't open checkout",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={cn("relative h-full overflow-hidden", className)}>
      {/* ── Ambient blue backdrop + drifting motes (matches the Recovery Pro
          gate / Welcome-to-Pro visual language). ── */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, hsl(var(--primary) / 0.08) 55%, hsl(217 91% 58% / 0.16) 82%, hsl(213 94% 68% / 0.22) 100%)",
        }}
        initial={prefersReduced ? false : { opacity: 0 }}
        animate={prefersReduced ? { opacity: 1 } : { opacity: 1, scale: [1, 1.05, 1] }}
        transition={
          prefersReduced
            ? { duration: 0 }
            : {
                opacity: { duration: 1, ease: "easeOut" },
                scale: { duration: 8, ease: "easeInOut", repeat: Infinity },
              }
        }
      />
      {!prefersReduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {MOTES.map((m, i) => (
            <motion.span
              key={i}
              className="absolute bottom-0 rounded-full bg-blue-300/70"
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                filter: "blur(0.5px)",
                boxShadow: "0 0 7px hsl(213 94% 70% / 0.7)",
              }}
              initial={{ opacity: 0, y: 0 }}
              animate={{ opacity: [0, 0.7, 0], y: [-12, -780] }}
              transition={{ duration: m.dur, delay: m.delay, repeat: Infinity, ease: "easeOut" }}
            />
          ))}
        </div>
      )}

      {/* ── Scrollable content, layered over the animated backdrop ── */}
      <div
        className="relative z-10 h-full overflow-y-auto overscroll-contain px-6"
        style={{ paddingTop: 8, paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
      {/* ── Hero ── */}
      <motion.div
        className="flex flex-col items-center text-center pt-2"
        initial={prefersReduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springs.gentle}
      >
        {/* Shimmer crown: the shared premium marker, prominent + glowing. */}
        <div className="relative mb-5">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 blur-2xl opacity-60"
            style={{ background: "radial-gradient(circle, hsl(217 91% 58% / 0.55) 0%, transparent 70%)" }}
          />
          <ShimmerCrownBadge size={68} />
        </div>

        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/90">
          Fight Camp Coach · Pro
        </span>

        <h1 className="mt-2 text-2xl font-bold text-foreground leading-snug max-w-[320px]">
          Unlock your AI cornerman
        </h1>

        {/* Contextual hook from the live briefing (or generic fallback). */}
        <p className="mt-2.5 text-sm text-muted-foreground max-w-[300px] leading-relaxed">
          {hook}
        </p>
      </motion.div>

      {/* ── Value reasons (staggered) ── */}
      <motion.ul
        className="mt-8 space-y-3"
        variants={staggerContainer(60, 120)}
        initial={prefersReduced ? false : "hidden"}
        animate="visible"
      >
        {PRO_REASONS.map((reason) => (
          <motion.li
            key={reason.title}
            variants={prefersReduced ? undefined : staggerItem}
            className="flex items-center gap-3.5 rounded-2xl border border-border/50 bg-card/60 p-3.5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center">
              <Icon name={reason.icon} size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground leading-snug">{reason.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{reason.sub}</p>
            </div>
          </motion.li>
        ))}
      </motion.ul>

      {/* ── CTA ── */}
      <motion.div
        className="mt-7"
        initial={prefersReduced ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.gentle, delay: prefersReduced ? 0 : 0.55 }}
      >
        <button
          onClick={handleUnlock}
          className="relative w-full h-12 rounded-2xl text-base font-bold text-primary-foreground bg-gradient-to-r from-primary to-secondary active:scale-[0.97] transition-transform overflow-hidden"
          style={{ boxShadow: "0 0 24px hsl(217 91% 58% / 0.35)" }}
        >
          <span className="relative z-10 inline-flex items-center justify-center gap-2">
            <Icon name="sparklesOutline" size={18} className="text-primary-foreground" />
            Unlock Pro
          </span>
          {!prefersReduced && (
            <motion.span
              aria-hidden
              className="absolute top-0 -left-1/2 h-full w-1/3 bg-white/25"
              style={{ transform: "skewX(-20deg)" }}
              initial={{ x: "-160%" }}
              animate={{ x: "420%" }}
              transition={{ duration: 1.1, ease: "easeOut", repeat: Infinity, repeatDelay: 2.8, delay: 1.2 }}
            />
          )}
        </button>

        <p className="mt-3 text-center text-[11px] text-muted-foreground/60 leading-relaxed">
          Includes a 7-day free trial. Cancel anytime.
        </p>
      </motion.div>
      </div>
    </div>
  );
}
