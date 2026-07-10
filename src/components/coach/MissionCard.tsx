import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import type { Doc, Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection, triggerHapticSuccess } from "@/lib/haptics";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { cn, stripDashes } from "@/lib/utils";
import { springs } from "@/lib/motion";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { pushMasterySignal } from "@/components/mastery/masteryGenerationSignals";
import { LevelRing } from "./LevelRing";

type Mission = Doc<"training_missions"> & {
  items: Doc<"training_mission_items">[];
};

interface MissionCardProps {
  mission: Mission;
  /** Whether the card body is expanded. Controlled by the parent so
   *  multiple cards behave like an accordion. */
  expanded: boolean;
  /** Toggle expand/collapse from a header tap. */
  onToggle: () => void;
}

const COLLAPSED_ITEM_COUNT = 5;

/** XP awarded per item tick (backend constant, render-time mirror only). */
const XP_PER_ITEM = 20;

/**
 * Normalise AI-generated advice so every item reads with identical
 * indentation: collapse stray whitespace/newlines and strip any leading
 * list marker (dash, bullet, or "1." / "1)" numbering) the model sometimes
 * emits for some items but not others.
 */
function cleanAdvice(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s\-*•]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

/** Labels for drillType chips. */
const DRILL_TYPE_LABEL: Record<string, string> = {
  solo: "SOLO",
  partner: "PARTNER",
  live: "LIVE",
  shadow: "SHADOW",
};

/**
 * A pair of chips shown under each drill item: a fixed-width drillType chip
 * (78 px) and a duration chip (66 px). They form two aligned columns across
 * all drill rows. Each chip is hidden when its datum is absent.
 * iOS perf: border + bg-tint only — no blur/shadow/filter.
 */
function DrillChips({
  drillType,
  durationMin,
  token,
}: {
  drillType?: string | null;
  durationMin?: number | null;
  token: string;
}) {
  if (!drillType && !durationMin) return null;

  const typeLabel = drillType ? (DRILL_TYPE_LABEL[drillType] ?? drillType.toUpperCase()) : null;
  const timeLabel = durationMin != null
    ? drillType === "live" ? `${durationMin} rounds` : `${durationMin} min`
    : null;

  return (
    <div className="flex gap-2 mt-2">
      {typeLabel != null ? (
        <span
          className="inline-flex items-center text-[10px] font-semibold tracking-wide py-1"
          style={{
            width: 78,
            color: `hsl(var(${token}))`,
          }}
        >
          {typeLabel}
        </span>
      ) : (
        /* Invisible placeholder keeps the time chip in column 2 */
        <span style={{ width: 78, flexShrink: 0 }} />
      )}
      {timeLabel != null && (
        <span
          className="inline-flex items-center text-[10px] font-semibold tracking-wide py-1 text-muted-foreground"
          style={{ width: 66 }}
        >
          {timeLabel}
        </span>
      )}
    </div>
  );
}

/**
 * A single checklist row with the full tick-reward animation: a background
 * that fades to the discipline accent, a one-shot flash overlay, the animated
 * checkbox, a strikethrough sweep over the text, and a "+20 XP" float on tick.
 * Holds its own `floatKey` so the float retriggers per tick-on (mirrors the
 * approved mockup's TickRow). Tap logic is delegated to the parent's handler.
 */
function TickRow({
  item,
  token,
  disabled,
  onTick,
}: {
  item: Doc<"training_mission_items">;
  token: string;
  disabled: boolean;
  onTick: (itemId: Id<"training_mission_items">, currentlyCompleted: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const [floatKey, setFloatKey] = useState(0);
  const done = item.completed;

  const handle = () => {
    if (disabled) return;
    // Float only when ticking ON, never on untick.
    if (!done) setFloatKey((k) => k + 1);
    onTick(item._id, done);
  };

  return (
    <motion.button
      type="button"
      onClick={handle}
      disabled={disabled}
      className="relative w-full min-h-[36px] flex items-start gap-2.5 px-2.5 py-2 rounded-xs text-left overflow-hidden"
      animate={{
        backgroundColor: done
          ? "hsl(var(--primary) / 0.06)"
          : "hsla(0,0%,100%,0.03)",
      }}
      whileTap={{ scale: 0.99 }}
      aria-pressed={done}
      aria-label={done ? `Untick: ${item.text}` : `Mark complete: ${item.text}`}
    >
      <AnimatePresence>
        {done && !reduced && (
          <motion.span
            key="flash"
            className="absolute inset-0 pointer-events-none"
            style={{ background: `hsl(var(${token}) / 0.18)` }}
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        )}
      </AnimatePresence>

      <AnimatedCheckbox done={done} token={token} />

      <div className="flex-1 min-w-0">
        <span className="relative inline-block">
          <motion.span
            className="block text-[12px] leading-snug line-clamp-2"
            animate={{
              color: done
                ? "hsl(var(--muted-foreground))"
                : "hsl(var(--foreground))",
            }}
          >
            {stripDashes(cleanAdvice(item.text))}
          </motion.span>
          <motion.span
            className="absolute left-0 top-1/2 h-[1.5px] origin-left"
            style={{ background: "hsl(var(--muted-foreground))", width: "100%" }}
            initial={false}
            animate={{ scaleX: done ? 1 : 0 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: "easeOut" }}
          />
        </span>
        <DrillChips drillType={item.drillType} durationMin={item.durationMin} token={token} />
      </div>

      <XpFloat floatKey={floatKey} token={token} amount={XP_PER_ITEM} />
    </motion.button>
  );
}

/**
 * Single Training Mission. The card is an accordion item: the header
 * is always visible (discipline label, level, title, progress, chevron) and
 * the body (rationale disclosure + checklist) appears only when `expanded`.
 *
 * Items support tick AND untick (in case of accidental taps). Ticking an item
 * floats its "+20 XP" inline; the only full-screen celebration in the Mastery
 * flow is MasteryCutscene, fired once per completed discipline cycle.
 */
export function MissionCard({ mission, expanded, onToggle }: MissionCardProps) {
  // Discipline accent — used ONLY for the discipline name label. Every other
  // accent on the card (level ring, progress bar, checkboxes, chips, XP) uses
  // the wizard-blue primary so the card reads as one calm blue system and only
  // the martial-art name carries its discipline colour.
  const token = disciplineToken(mission.sport);
  const accent = "--primary";
  const label = disciplineLabel(mission.sport);
  const prefersReduced = useReducedMotion();

  const items = mission.items;
  const totalCount = items.length;
  const doneCount = useMemo(
    () => items.filter((i) => i.completed).length,
    [items],
  );
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // Item collapse state persists across navigation via localStorage.
  const itemsExpandedKey = `wcw_mission_items_expanded_${mission._id}`;
  const [itemsExpanded, setItemsExpanded] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(itemsExpandedKey);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      /* ignore */
    }
    return totalCount <= COLLAPSED_ITEM_COUNT;
  });
  useEffect(() => {
    try {
      localStorage.setItem(itemsExpandedKey, itemsExpanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [itemsExpanded, itemsExpandedKey]);

  const visibleItems = itemsExpanded
    ? items
    : items.slice(0, COLLAPSED_ITEM_COUNT);

  const [pending, setPending] = useState<Id<"training_mission_items"> | null>(
    null,
  );

  // Per-discipline XP, drives the LevelRing on the card header. Lives behind a
  // dedicated query so the header still renders instantly when this comes back
  // `undefined` (initial load); we just show level 1 / progress 0 in that case.
  // Scope to the mission's OWN camp — XP is stored per (user, camp, sport), so
  // a no-arg read returns the earliest camp's row, not this mission's. Legacy
  // missions without a campId fall back to the unscoped (pre-per-camp) row.
  const disciplineXp = useQuery(api.user_discipline_xp.getForSport, {
    sport: mission.sport,
    campId: mission.campId,
  });
  const xpLevel = disciplineXp?.level ?? 1;
  const xpProgress = disciplineXp?.progress ?? 0;

  const markItemCompleted = useMutation(api.training_missions.markItemCompleted);

  const handleTick = async (
    itemId: Id<"training_mission_items">,
    currentlyCompleted: boolean,
  ) => {
    if (pending) return;
    setPending(itemId);
    triggerHapticSelection();
    try {
      const result = await markItemCompleted({
        itemId,
        completed: !currentlyCompleted,
      });
      // Only react when we just transitioned TO completed (tick), never untick.
      if (!currentlyCompleted && result.missionCompleted) {
        // The final drill of the mission was just ticked: this kicks off the
        // async drill→spar graduation backend-side. Push an optimistic signal
        // so the Mastery sparring wizard loader shows immediately instead of
        // racing the job marker. `result.missionCompleted` (+ the !untick
        // guard) means we only push on the transition to fully complete, once.
        pushMasterySignal(mission.sport, "sparring");
        void triggerHapticSuccess();
      }
    } catch (err) {
      console.warn("MissionCard: markItemCompleted failed", err);
    } finally {
      setPending(null);
    }
  };

  return (
    /* Root is a keyed motion element; its EXIT is owned by the parent's
       <AnimatePresence> in MasterySpine. When all drills are ticked the
       mission auto-archives server-side and leaves the flow, so this card
       fades while its height (and space-y margin) collapses to 0, and the
       remaining cards slide up via natural reflow in one continuous motion,
       with no jump when the element unmounts. New cards fade in and rise
       ~12px into place. `layout="position"` (cheap position-only FLIP)
       smooths any residual reordering. iOS-safe: opacity/transform/height
       only, no scale. */
      <motion.div
        layout="position"
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={prefersReduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={springs.gentle}
        exit={
          prefersReduced
            ? { opacity: 0, transition: { duration: 0.15 } }
            : {
                opacity: 0,
                height: 0,
                marginTop: 0,
                marginBottom: 0,
                transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
              }
        }
        className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden"
      >
        {/* Premium animated wizard-blue ambient backdrop (replaces the old
            discipline-tinted gradient wash). Sits behind all card content;
            handles reduced-motion internally. */}
        <WizardAuroraBackground intensity="subtle" />
        {/* ────────────────────────────────────────────────────────────
            Header: always visible, tap to expand/collapse.
            Layout: [ring] [discipline + Lv + title] [done/total] [chevron]
            ──────────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            onToggle();
          }}
          aria-expanded={expanded}
          className="relative w-full min-h-[72px] px-4 py-3 flex items-center gap-3 text-left active:bg-muted/15 transition-colors"
        >
          {/* Level ring: renders with level 1 / progress 0 while the
              per-sport XP query is loading. */}
          <LevelRing
            token={accent}
            level={xpLevel}
            progress={xpProgress}
            size={44}
          />

          {/* Discipline + level (plain coloured text) above the mission title. */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: `hsl(var(${token}))` }}
              >
                {label}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Lv {xpLevel}
              </span>
            </div>
            <p className="text-body-sm font-semibold text-foreground leading-snug break-words">
              {mission.title}
            </p>
          </div>

          {/* Mission item count "3/7", coloured once the user has started. */}
          <span
            className="text-[12px] tabular-nums font-bold flex-shrink-0"
            style={{
              color:
                doneCount > 0
                  ? `hsl(var(${accent}))`
                  : "hsl(var(--muted-foreground))",
            }}
          >
            {doneCount}/{totalCount}
          </span>

          {/* Chevron */}
          <Icon
            name="chevronDownOutline"
            size={16}
            className={cn(
              "text-muted-foreground/60 flex-shrink-0 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>

        {/* Single thin progress bar directly under the header. */}
        <div className="relative px-4">
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `hsl(var(${accent}))` }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: prefersReduced ? 0 : 0.5 }}
            />
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────
            Body: only rendered when expanded.
            ──────────────────────────────────────────────────────────── */}
        {expanded && (
          <div className="relative pl-4 pr-4 pt-3 pb-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Items: text + drill chips, with the full tick-reward animation. */}
            <ul className="space-y-1.5" role="list">
              {visibleItems.map((item) => (
                <li key={item._id}>
                  <TickRow
                    item={item}
                    token={accent}
                    disabled={pending === item._id}
                    onTick={handleTick}
                  />
                </li>
              ))}
            </ul>

            {/* Show all / collapse items toggle */}
            {totalCount > COLLAPSED_ITEM_COUNT && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  setItemsExpanded((e) => !e);
                }}
                className="w-full min-h-[36px] flex items-center justify-center gap-1.5 text-note font-semibold text-muted-foreground/80 active:text-foreground"
              >
                {itemsExpanded ? "Show fewer" : `Show all ${totalCount} items`}
                <Icon
                  name="chevronForwardOutline"
                  size={14}
                  className={cn(
                    "transition-transform",
                    itemsExpanded && "rotate-90",
                  )}
                />
              </button>
            )}
          </div>
        )}
      </motion.div>
  );
}
