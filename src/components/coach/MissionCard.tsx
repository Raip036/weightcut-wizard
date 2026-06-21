import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import type { Doc, Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection, triggerHapticSuccess } from "@/lib/haptics";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { levelFromXp } from "@/lib/xp";
import { cn, stripDashes } from "@/lib/utils";
import { CompleteCelebration } from "@/components/motion";
import { AnimatedCheckbox, XpFloat } from "@/components/coach/TickReward";
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
      layout
      className="relative w-full min-h-[36px] flex items-start gap-2.5 px-2.5 py-2 rounded-xs text-left overflow-hidden"
      animate={{
        backgroundColor: done
          ? `hsl(var(${token}) / 0.06)`
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
 * Items support tick AND untick (in case of accidental taps). Ticking the
 * final unchecked item fires a full-screen completion celebration.
 */
export function MissionCard({ mission, expanded, onToggle }: MissionCardProps) {
  const token = disciplineToken(mission.sport);
  const label = disciplineLabel(mission.sport);
  const prefersReduced = useReducedMotion();

  const items = mission.items;
  const totalCount = items.length;
  const doneCount = useMemo(
    () => items.filter((i) => i.completed).length,
    [items],
  );
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  // "Why this mission" rationale disclosure, collapsed by default.
  const [showWhy, setShowWhy] = useState(false);

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
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionAward, setCompletionAward] = useState<{
    xpAwarded: number;
    leveledUp: boolean;
    newLevel: number;
  }>({ xpAwarded: 0, leveledUp: false, newLevel: 1 });

  // Per-discipline XP, drives the LevelRing on the card header. Lives behind a
  // dedicated query so the header still renders instantly when this comes back
  // `undefined` (initial load); we just show level 1 / progress 0 in that case.
  const disciplineXp = useQuery(api.user_discipline_xp.getForSport, {
    sport: mission.sport,
  });
  const xpLevel = disciplineXp?.level ?? 1;
  const xpProgress = disciplineXp?.progress ?? 0;
  const xpTotal = disciplineXp?.totalXp ?? 0;

  const markItemCompleted = useMutation(api.training_missions.markItemCompleted);

  const handleTick = async (
    itemId: Id<"training_mission_items">,
    currentlyCompleted: boolean,
  ) => {
    if (pending) return;
    setPending(itemId);
    triggerHapticSelection();
    // Snapshot the pre-tick XP so we can detect a level-up by comparing the
    // synchronous derived level before vs. after applying `xpAwarded`.
    const prevTotalXp = xpTotal;
    try {
      const result = await markItemCompleted({
        itemId,
        completed: !currentlyCompleted,
      });
      // Only show the completion celebration when we just transitioned
      // TO completed (tick), never on an untick.
      if (!currentlyCompleted && result.missionCompleted) {
        const awarded = result.xpAwarded ?? 0;
        const newLevel = levelFromXp(prevTotalXp + awarded).level;
        const leveledUp =
          awarded > 0 && newLevel > levelFromXp(prevTotalXp).level;
        setCompletionAward({ xpAwarded: awarded, leveledUp, newLevel });
        setCompleteOpen(true);
      }
    } catch (err) {
      console.warn("MissionCard: markItemCompleted failed", err);
    } finally {
      setPending(null);
    }
  };

  // Fire success haptic + auto-dismiss the celebration. Auto-dismiss runs
  // shorter under reduced motion; a tap also closes it (see overlay button).
  useEffect(() => {
    if (!completeOpen) return;
    void triggerHapticSuccess();
    const t = setTimeout(
      () => setCompleteOpen(false),
      prefersReduced ? 1600 : 2600,
    );
    return () => clearTimeout(t);
  }, [completeOpen, prefersReduced]);

  return (
    <>
      <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
        />
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
            token={token}
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
                  ? `hsl(var(${token}))`
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
        <div className="px-4">
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `hsl(var(${token}))` }}
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
            {/* "Why this mission", collapsed by default. */}
            {mission.rationale && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowWhy((w) => !w)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground/70 active:text-foreground"
                  aria-expanded={showWhy}
                >
                  <Icon name="informationCircleOutline" size={12} />
                  Why this mission
                  <Icon
                    name="chevronDownOutline"
                    size={12}
                    className={cn(
                      "transition-transform",
                      showWhy && "rotate-180",
                    )}
                  />
                </button>
                <AnimatePresence initial={false}>
                  {showWhy && (
                    <motion.p
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden text-note text-muted-foreground leading-snug mt-1.5"
                    >
                      {stripDashes(cleanAdvice(mission.rationale))}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Items: text only, with the full tick-reward animation. */}
            <ul className="space-y-1.5" role="list">
              {visibleItems.map((item) => (
                <li key={item._id}>
                  <TickRow
                    item={item}
                    token={token}
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
      </div>

      {/* Full-screen completion celebration: replaces the old modal. */}
      <AnimatePresence>
        {completeOpen && (
          <button
            type="button"
            onClick={() => setCompleteOpen(false)}
            aria-label="Dismiss"
            className="fixed inset-0 z-[100] cursor-default"
          >
            <CompleteCelebration
              prefersReduced={prefersReduced}
              accentToken={token}
              xp={completionAward.xpAwarded}
              eyebrow={completionAward.leveledUp ? "Level up" : "Mission complete"}
              title={
                completionAward.leveledUp
                  ? `Level ${completionAward.newLevel} reached`
                  : "Every drill ticked"
              }
              subtitle="Log your next session to unlock your next mission."
            />
          </button>
        )}
      </AnimatePresence>
    </>
  );
}
