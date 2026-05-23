import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import type { Doc, Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSelection } from "@/lib/haptics";
import { disciplineLabel, disciplineToken } from "@/lib/coachColors";
import { levelFromXp } from "@/lib/xp";
import { cn } from "@/lib/utils";
import { LevelRing } from "./LevelRing";
import { MissionCompleteDialog } from "./MissionCompleteDialog";

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

/**
 * Single Training Mission. The card is an accordion item — the header
 * is always visible (discipline pill, title, progress, chevron) and the
 * body (rationale + checklist) appears only when `expanded` is true.
 *
 * Items support tick AND untick (in case of accidental taps). Ticking
 * the final unchecked item still fires the Mission Complete dialog.
 */
export function MissionCard({ mission, expanded, onToggle }: MissionCardProps) {
  const token = disciplineToken(mission.sport);
  const label = disciplineLabel(mission.sport);

  const items = mission.items;
  const totalCount = items.length;
  const doneCount = useMemo(
    () => items.filter((i) => i.completed).length,
    [items],
  );
  const progressPct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const [itemsExpanded, setItemsExpanded] = useState(
    totalCount <= COLLAPSED_ITEM_COUNT,
  );
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
  }>({ xpAwarded: 0, leveledUp: false });

  // Per-discipline XP — drives the LevelRing on the card header. Lives behind a
  // dedicated query so the header still renders instantly when this comes back
  // `undefined` (initial load); we just show level 1 / progress 0 in that case.
  const disciplineXp = useQuery(
    api.user_discipline_xp.getForSport,
    { sport: mission.sport },
  );
  const xpLevel = disciplineXp?.level ?? 1;
  const xpProgress = disciplineXp?.progress ?? 0;
  const xpCurrent = disciplineXp?.currentLevelXp ?? 0;
  const xpNext = disciplineXp?.nextLevelXp ?? 50;
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
      // Only show the Mission Complete dialog when we just transitioned
      // TO completed (tick), never on an untick.
      if (!currentlyCompleted && result.missionCompleted) {
        const awarded = result.xpAwarded ?? 0;
        const leveledUp =
          awarded > 0 &&
          levelFromXp(prevTotalXp + awarded).level >
            levelFromXp(prevTotalXp).level;
        setCompletionAward({ xpAwarded: awarded, leveledUp });
        setCompleteOpen(true);
      }
    } catch (err) {
      console.warn("MissionCard: markItemCompleted failed", err);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <div className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
        />
        {/* ────────────────────────────────────────────────────────────
            Header — always visible, tap to expand/collapse.
            Layout: [ring] [discipline + Lv chip + title] [XP] [chevron]
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
          {/* Level ring — replaces the old accent stripe. Renders with level
              1 / progress 0 while the per-sport XP query is loading. */}
          <LevelRing
            token={token}
            level={xpLevel}
            progress={xpProgress}
            size={44}
          />

          {/* Discipline + level chip stacked above the mission title. */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span
                className={cn(
                  "inline-flex items-center h-5 px-2 rounded-full flex-shrink-0",
                  "text-[10px] font-bold uppercase tracking-wider",
                )}
                style={{
                  backgroundColor: `hsl(var(${token}) / 0.15)`,
                  color: `hsl(var(${token}))`,
                }}
              >
                {label}
              </span>
              <span
                className="inline-flex items-center h-5 px-1.5 rounded-full bg-muted/25 text-[10px] font-bold uppercase tracking-wider tabular-nums"
                style={{ color: `hsl(var(${token}))` }}
              >
                Lv {xpLevel}
              </span>
            </div>
            <p className="text-body-sm font-semibold text-foreground leading-tight truncate">
              {mission.title}
            </p>
          </div>

          {/* XP "240 / 450" — tabular, muted, right-aligned before the chevron. */}
          <span className="text-micro tabular-nums font-bold text-muted-foreground/70 flex-shrink-0">
            {xpCurrent}
            <span className="text-muted-foreground/40"> / </span>
            {xpNext}
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

        {/* ────────────────────────────────────────────────────────────
            Body — only rendered when expanded.
            ──────────────────────────────────────────────────────────── */}
        {expanded && (
          <div className="relative pl-4 pr-4 pb-4 space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-200">
            {/* Rationale */}
            {mission.rationale && (
              <p className="text-note text-muted-foreground leading-snug">
                {mission.rationale}
              </p>
            )}

            {/* Mission progress — per-item progress for this mission, distinct
                from the level XP ring shown in the header. */}
            <div className="space-y-1.5">
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: `hsl(var(${token}))`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">
                  Mission progress
                </p>
                <p className="text-micro tabular-nums font-bold text-muted-foreground/80">
                  {doneCount}/{totalCount}
                </p>
              </div>
            </div>

            {/* Items */}
            <ul className="space-y-2" role="list">
              {visibleItems.map((item) => {
                const isPending = pending === item._id;
                return (
                  <li key={item._id}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleTick(item._id, item.completed)}
                      className={cn(
                        "w-full min-h-[36px] flex items-start gap-2.5 px-2.5 py-1.5 rounded-xs text-left",
                        "transition-colors active:scale-[0.995]",
                        item.completed
                          ? "bg-muted/15 active:bg-muted/25"
                          : "bg-muted/8 hover:bg-muted/20 active:bg-muted/25",
                      )}
                      aria-pressed={item.completed}
                      aria-label={
                        item.completed
                          ? `Untick: ${item.text}`
                          : `Mark complete: ${item.text}`
                      }
                    >
                      {/* Checkbox */}
                      <span
                        className={cn(
                          "h-4 w-4 rounded-xs border flex items-center justify-center flex-shrink-0 mt-[1px] transition-colors",
                          item.completed ? "" : "border-border",
                        )}
                        style={
                          item.completed
                            ? {
                                backgroundColor: `hsl(var(${token}))`,
                                borderColor: `hsl(var(${token}))`,
                              }
                            : undefined
                        }
                        aria-hidden
                      >
                        {item.completed && (
                          <Icon
                            name="checkmarkOutline"
                            size={11}
                            className="text-background"
                          />
                        )}
                      </span>

                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p
                          className={cn(
                            "text-[12px] leading-snug",
                            item.completed
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {item.text}
                        </p>
                        {(item.technique ||
                          item.drillType ||
                          item.durationMin) && (
                          <div className="flex flex-wrap items-center gap-1">
                            {item.technique && (
                              <span className="text-[9px] uppercase tracking-wide font-bold text-muted-foreground/80 bg-muted/30 rounded-xs px-1 py-px">
                                {item.technique}
                              </span>
                            )}
                            {item.drillType && (
                              <span
                                className="text-[9px] uppercase tracking-wide font-bold rounded-xs px-1 py-px"
                                style={{
                                  color: `hsl(var(${token}))`,
                                  backgroundColor: `hsl(var(${token}) / 0.12)`,
                                }}
                              >
                                {item.drillType}
                              </span>
                            )}
                            {item.durationMin && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-muted-foreground/80">
                                <Icon name="timeOutline" size={10} />
                                {item.durationMin}m
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
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
                {itemsExpanded
                  ? "Show fewer"
                  : `Show all ${totalCount} items`}
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

      <MissionCompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        missionTitle={mission.title}
        sport={mission.sport}
        xpAwarded={completionAward.xpAwarded}
        leveledUp={completionAward.leveledUp}
      />
    </>
  );
}
