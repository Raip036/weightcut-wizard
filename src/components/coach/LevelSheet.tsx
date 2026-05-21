import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Flame,
  Calendar,
  Check,
  Trophy,
  Pen,
  Utensils,
  Scale,
  TrendingUp,
  Award,
  Zap,
  Star,
  Dumbbell,
  Crown,
} from "lucide-react";
import { LevelRing } from "./LevelRing";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { useUser } from "@/contexts/UserContext";
import { useGamification } from "@/hooks/useGamification";
import type { MilestoneBadge } from "@/hooks/useGamification";
import { AchievementSheet } from "@/components/achievements/AchievementSheet";
import { cn } from "@/lib/utils";

/**
 * LevelSheet — bottom sheet surfacing the user's per-discipline XP, how to
 * earn XP, what it means, current streak, an achievements preview, and a
 * placeholder list of "daily challenges" that will start tracking in v2.
 *
 * Opened from `<XpSummaryCard>` on `/camp`. All data is read live (no extra
 * caching layer beyond what the underlying queries / hooks already provide).
 */
interface LevelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Map MilestoneBadge.icon → lucide component (mirrors MilestoneBadges.tsx).
const BADGE_ICON_MAP = {
  Flame,
  Calendar,
  Utensils,
  Trophy,
  Scale,
  TrendingUp,
  Award,
  Zap,
  Star,
  Dumbbell,
  Crown,
} as const;

/* "How to earn XP" — static config so the rows stay declarative. */
const EARN_ROWS: ReadonlyArray<{
  icon: typeof Calendar;
  amount: string;
  label: string;
}> = [
  { icon: Calendar, amount: "+10 XP", label: "Log a session in the Training Calendar" },
  { icon: Check, amount: "+20 XP", label: "Tick a Training Coach mission item" },
  { icon: Trophy, amount: "+100 XP", label: "Complete an entire mission" },
];

/* "Daily challenges" — v1 placeholder data. No live tracking yet. */
const DAILY_CHALLENGES: ReadonlyArray<{
  icon: typeof Calendar;
  title: string;
  bonus: string;
}> = [
  { icon: Calendar, title: "Log a session today", bonus: "+25 XP" },
  { icon: Check, title: "Tick 3 mission items today", bonus: "+50 XP" },
  { icon: Pen, title: "Write notes for 1 session", bonus: "+15 XP" },
];

export function LevelSheet({ open, onOpenChange }: LevelSheetProps) {
  const { userId, profile } = useUser();
  const [achievementsOpen, setAchievementsOpen] = useState(false);

  // Per-discipline XP rows — drives the top section.
  const xpRows = useQuery(api.user_discipline_xp.getAllForUser);

  // Pull a recent weight-log window so the streak math has real input. We
  // only need date strings — `useGamification` collapses to date sets.
  const liveWeightLogs = useQuery(
    api.weight_logs.listForUser,
    userId ? { limit: 60 } : "skip",
  );

  const weightLogsForHook = useMemo(
    () =>
      (liveWeightLogs ?? []).map((l) => ({
        date: l.date,
        // Hook expects `weight_kg` as string (Dashboard normalises the
        // same way); coerce here so the streak math still works.
        weight_kg: String(l.weight_kg),
      })),
    [liveWeightLogs],
  );

  // todayCalories isn't used for the streak / badge surfaces we read, so we
  // can safely pass 0 here. We piggyback on the same hook the dashboard uses
  // so the underlying unlocked / progress state is identical.
  const { streak, badges, allAchievements } = useGamification(
    userId ?? null,
    weightLogsForHook,
    0,
    profile,
  );

  const topBadges = badges.slice(0, 4);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[92vh] rounded-t-2xl flex flex-col"
        >
          <SheetHeader className="mb-4 flex-shrink-0">
            <SheetTitle>Your level</SheetTitle>
            <p className="text-note text-muted-foreground">
              Progress per discipline, plus how to earn XP.
            </p>
          </SheetHeader>

          <div
            className="flex-1 overflow-y-auto scrollbar-hide space-y-6"
            style={{
              paddingBottom:
                "max(env(safe-area-inset-bottom, 0px), 6rem)",
            }}
          >
            {/* ── 1. All disciplines ───────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                All disciplines
              </h3>
              <DisciplineList rows={xpRows} />
            </section>

            {/* ── 2. How to earn XP ────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                How to earn XP
              </h3>
              <div className="space-y-2">
                {EARN_ROWS.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.label}
                      className="card-surface rounded-xs p-3 flex items-center gap-3 min-h-[44px]"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <p className="flex-1 text-body-sm text-foreground leading-tight">
                        {row.label}
                      </p>
                      <span className="text-note font-semibold text-primary tabular-nums flex-shrink-0">
                        {row.amount}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── 3. What it means ─────────────────────────────────────── */}
            <section className="space-y-2">
              <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                What it means
              </h3>
              <p className="text-note text-muted-foreground leading-relaxed">
                Each discipline tracks its own progress so the work you put
                into BJJ stays separate from your Muay Thai or strength.
                Level thresholds widen as you climb — early levels come
                quickly, advanced ones take real consistency.
              </p>
            </section>

            {/* ── 4. Streak ────────────────────────────────────────────── */}
            {streak > 0 && (
              <section className="space-y-3">
                <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                  Streak
                </h3>
                <div className="card-surface rounded-xs p-3 flex items-center gap-3 min-h-[44px]">
                  <div className="w-10 h-10 rounded-full bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                    <Flame className="h-5 w-5 text-orange-400" />
                  </div>
                  <p className="text-body-sm font-semibold text-foreground tabular-nums">
                    {streak}-day streak
                  </p>
                </div>
              </section>
            )}

            {/* ── 5. Achievements preview ──────────────────────────────── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                  Achievements
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {topBadges.map((badge) => (
                  <BadgePreviewTile key={badge.id} badge={badge} />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAchievementsOpen(true)}
                className="block mx-auto text-note font-medium text-primary touch-target"
              >
                See all achievements
              </button>
            </section>

            {/* ── 6. Daily challenges (placeholder) ────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                Daily challenges
              </h3>
              <div className="space-y-2">
                {DAILY_CHALLENGES.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.title}
                      className="card-surface rounded-xs p-3 flex items-center gap-3 min-h-[44px] opacity-80"
                    >
                      <div className="w-8 h-8 rounded-full bg-muted/30 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-body-sm text-foreground leading-tight truncate">
                          {row.title}
                        </p>
                        <p className="text-micro text-muted-foreground/70 leading-tight mt-0.5">
                          Coming soon
                        </p>
                      </div>
                      <span className="text-note font-semibold text-primary tabular-nums flex-shrink-0 px-2 py-0.5 rounded-full bg-primary/10">
                        {row.bonus}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Achievement sheet rendered as a sibling so taps on the preview
          header / "See all" link open the full skill tree without
          unmounting LevelSheet's state. */}
      <AchievementSheet
        open={achievementsOpen}
        onOpenChange={setAchievementsOpen}
        categories={allAchievements}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Internal sub-components
// ───────────────────────────────────────────────────────────────────────────

type DisciplineRow = {
  sport: string;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  totalXp?: number;
};

function DisciplineList({
  rows,
}: {
  rows: DisciplineRow[] | undefined;
}) {
  if (rows === undefined) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="card-surface rounded-xs p-3 flex items-center gap-3 min-h-[44px]"
          >
            <div className="w-12 h-12 rounded-full shimmer-skeleton flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded shimmer-skeleton" />
              <div className="h-2 w-16 rounded shimmer-skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="card-surface rounded-xs p-4">
        <p className="text-note text-muted-foreground leading-snug">
          Train and log notes to start earning XP.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const token = disciplineToken(row.sport);
        const label = disciplineLabel(row.sport);
        return (
          <div
            key={row.sport}
            className="card-surface rounded-xs p-3 flex items-center gap-3 min-h-[44px]"
          >
            <LevelRing
              token={token}
              level={row.level}
              progress={row.progress}
              size={48}
            />
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-bold uppercase tracking-wider truncate leading-tight text-foreground">
                {label}
              </p>
              <p className="text-micro tabular-nums text-muted-foreground/80 leading-tight mt-0.5">
                <span className="tabular-nums">{row.currentLevelXp}</span>
                <span className="text-muted-foreground/40"> / </span>
                <span className="tabular-nums">{row.nextLevelXp}</span> XP
              </p>
            </div>
            {/* Level badge — flat foreground-on-muted, no discipline tint.
                The ring on the left already carries the discipline colour;
                duplicating it on the chip read as neon / AI-generated. */}
            <span
              className={cn(
                "inline-flex items-center h-6 px-2.5 rounded-xs flex-shrink-0",
                "text-micro font-bold uppercase tracking-wider tabular-nums",
                "bg-muted/30 text-foreground border border-border/60",
              )}
            >
              Lv {row.level}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BadgePreviewTile({ badge }: { badge: MilestoneBadge }) {
  const Icon = BADGE_ICON_MAP[badge.icon];
  return (
    <div className="rounded-xs p-3 text-center card-surface">
      <div
        className={cn(
          "relative w-10 h-10 rounded-full mx-auto flex items-center justify-center",
          badge.unlocked ? "bg-primary/20" : "bg-muted/20",
        )}
      >
        <Icon
          className={cn(
            "h-5 w-5",
            badge.unlocked ? "text-primary" : "text-muted-foreground",
          )}
        />
      </div>
      <div className="flex items-center justify-center gap-1 mt-2 min-w-0">
        <span className="text-xs font-semibold truncate">{badge.title}</span>
        {badge.unlocked && (
          <Check className="h-3 w-3 text-func-recovery-green flex-shrink-0" />
        )}
      </div>
      {!badge.unlocked && (
        <div className="h-1 rounded-full bg-muted mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round(badge.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
