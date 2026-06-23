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
  Utensils,
  Scale,
  TrendingUp,
  Award,
  Zap,
  Star,
  Dumbbell,
  Crown,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { LevelRing } from "./LevelRing";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { useUser } from "@/contexts/UserContext";
import { useGamification } from "@/hooks/useGamification";
import type { MilestoneBadge } from "@/hooks/useGamification";
import { AchievementSheet } from "@/components/achievements/AchievementSheet";
import { cn } from "@/lib/utils";

/**
 * LevelSheet: bottom sheet surfacing the user's per-discipline XP, how to
 * earn XP, what it means, current streak, and an achievements preview.
 *
 * Opened from the camp hero discipline rings. iOS inset-grouped-list grammar:
 * each section is one rounded panel with hairline-divided rows, and every
 * action carries its own semantic icon tint (no wall of identical blue).
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

/* Semantic icon colours. Color encodes meaning, not decoration: blue for
   logging, green for completing, gold for the big achievement-grade win.
   No backing tile — the glyph sits bare on the row. */
type Tone = "blue" | "green" | "gold" | "orange" | "neutral";
const TONE: Record<Tone, string> = {
  blue: "text-primary",
  green: "text-[hsl(var(--health))]",
  gold: "text-[hsl(var(--warning))]",
  orange: "text-[hsl(var(--energy))]",
  neutral: "text-muted-foreground",
};

/* "How to earn XP": static config so the rows stay declarative. */
const EARN_ROWS: ReadonlyArray<{
  icon: LucideIcon;
  amount: string;
  label: string;
  tone: Tone;
}> = [
  { icon: Calendar, amount: "+10", label: "Log a training session", tone: "blue" },
  { icon: Check, amount: "+20", label: "Tick off a coach mission task", tone: "green" },
  { icon: Trophy, amount: "+100", label: "Finish a full mission", tone: "gold" },
];

export function LevelSheet({ open, onOpenChange }: LevelSheetProps) {
  const { userId, profile } = useUser();
  const [achievementsOpen, setAchievementsOpen] = useState(false);

  // Per-discipline XP rows, drives the top section.
  const xpRows = useQuery(api.user_discipline_xp.getAllForUser);

  // Pull a recent weight-log window so the streak math has real input. We
  // only need date strings; `useGamification` collapses to date sets.
  const liveWeightLogs = useQuery(
    api.weight_logs.listForUser,
    userId ? { limit: 60 } : "skip",
  );

  const weightLogsForHook = useMemo(
    () =>
      (liveWeightLogs ?? []).map((l) => ({
        date: l.date,
        weight_kg: String(l.weight_kg),
      })),
    [liveWeightLogs],
  );

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
          hideClose
          className="h-[92vh] rounded-t-3xl flex flex-col px-5 pt-3"
        >
          {/* Grabber — native modal affordance. */}
          <div className="mx-auto mb-3 h-1 w-9 flex-shrink-0 rounded-full bg-white/15" />

          <SheetHeader className="mb-5 flex-shrink-0 text-left sm:text-left">
            <SheetTitle className="font-display text-[22px] font-bold tracking-tight">
              Your level
            </SheetTitle>
            <p className="text-[13px] text-muted-foreground leading-snug">
              Train to earn XP. Each discipline levels up on its own.
            </p>
          </SheetHeader>

          <div
            className="flex-1 overflow-y-auto scrollbar-hide space-y-7"
            style={{
              paddingBottom: "max(env(safe-area-inset-bottom, 0px), 6rem)",
            }}
          >
            {/* ── 1. Disciplines ───────────────────────────────────────── */}
            <section className="space-y-2.5">
              <SectionLabel>Your disciplines</SectionLabel>
              <DisciplineList rows={xpRows} />
              <p className="px-1 pt-1 text-[12px] leading-relaxed text-muted-foreground/80">
                Every discipline climbs separately, so your BJJ progress stays
                apart from boxing or strength. Higher levels take a little more
                XP each time.
              </p>
            </section>

            {/* ── 2. How to earn XP ────────────────────────────────────── */}
            <section className="space-y-2.5">
              <SectionLabel>How to earn XP</SectionLabel>
              <Group dividerInset="3.375rem">
                {EARN_ROWS.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 px-3.5 py-3"
                  >
                    <IconTile icon={row.icon} tone={row.tone} />
                    <p className="flex-1 text-[14px] text-foreground leading-tight">
                      {row.label}
                    </p>
                    <span className="text-[13px] font-semibold tabular-nums text-foreground/90 flex-shrink-0">
                      {row.amount}
                      <span className="text-muted-foreground/60 font-medium"> XP</span>
                    </span>
                  </div>
                ))}
              </Group>
            </section>

            {/* ── 3. Streak ────────────────────────────────────────────── */}
            {streak > 0 && (
              <section className="space-y-2.5">
                <SectionLabel>Streak</SectionLabel>
                <Group>
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <IconTile icon={Flame} tone="orange" />
                    <p className="flex-1 text-[14px] font-semibold text-foreground tabular-nums">
                      {streak}-day streak
                    </p>
                    <span className="text-[12px] text-muted-foreground">
                      Keep it going
                    </span>
                  </div>
                </Group>
              </section>
            )}

            {/* ── 4. Achievements ──────────────────────────────────────── */}
            <section className="space-y-2.5">
              <SectionLabel>Achievements</SectionLabel>
              <div className="grid grid-cols-2 gap-2.5">
                {topBadges.map((badge) => (
                  <BadgePreviewTile key={badge.id} badge={badge} />
                ))}
              </div>
              <Group>
                <button
                  type="button"
                  onClick={() => setAchievementsOpen(true)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-white/[0.03] transition-colors"
                >
                  <IconTile icon={Award} tone="gold" />
                  <span className="flex-1 text-[14px] font-medium text-foreground">
                    See all achievements
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                </button>
              </Group>
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

/** Uppercase section eyebrow, iOS grouped-list header. */
function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/** A rounded panel that hosts hairline-divided rows (inset past the icon). */
function Group({
  children,
  dividerInset = "0px",
}: {
  children: React.ReactNode;
  dividerInset?: string;
}) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div className="card-surface rounded-2xl overflow-hidden">
      {rows.map((row, i) => (
        <div key={i}>
          {i > 0 && (
            <div
              className="h-px bg-white/[0.06]"
              style={{ marginLeft: dividerInset }}
            />
          )}
          {row}
        </div>
      ))}
    </div>
  );
}

/** Bare coloured icon. Fixed-width wrapper keeps row alignment without a
    backing tile. */
function IconTile({ icon: Icon, tone }: { icon: LucideIcon; tone: Tone }) {
  return (
    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
      <Icon className={cn("h-[20px] w-[20px]", TONE[tone])} strokeWidth={2.2} />
    </div>
  );
}

type DisciplineRow = {
  sport: string;
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
  totalXp?: number;
};

function DisciplineList({ rows }: { rows: DisciplineRow[] | undefined }) {
  if (rows === undefined) {
    return (
      <Group dividerInset="4.75rem">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3.5 py-3 min-h-[64px]">
            <div className="h-12 w-12 rounded-full shimmer-skeleton flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded shimmer-skeleton" />
              <div className="h-2 w-16 rounded shimmer-skeleton" />
            </div>
          </div>
        ))}
      </Group>
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="card-surface rounded-2xl p-4">
        <p className="text-[13px] text-muted-foreground leading-snug">
          Train and log sessions to start earning XP.
        </p>
      </div>
    );
  }

  return (
    <Group dividerInset="4.75rem">
      {rows.map((row) => {
        const token = disciplineToken(row.sport);
        const label = disciplineLabel(row.sport);
        return (
          <div key={row.sport} className="flex items-center gap-3 px-3.5 py-3">
            <LevelRing
              token={token}
              level={row.level}
              progress={row.progress}
              size={48}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold truncate leading-tight text-foreground">
                {label}
              </p>
              <p className="text-[11.5px] tabular-nums text-muted-foreground/80 leading-tight mt-0.5">
                <span className="tabular-nums">{row.currentLevelXp}</span>
                <span className="text-muted-foreground/40"> / </span>
                <span className="tabular-nums">{row.nextLevelXp}</span> XP to next
              </p>
            </div>
            {/* Level badge: neutral, recessed. The ring already carries the
                discipline colour — duplicating it here read as neon. */}
            <span
              className={cn(
                "inline-flex items-center h-6 px-2.5 rounded-full flex-shrink-0",
                "text-[11px] font-bold uppercase tracking-wider tabular-nums",
                "surface-inset text-foreground/90",
              )}
            >
              Lv {row.level}
            </span>
          </div>
        );
      })}
    </Group>
  );
}

function BadgePreviewTile({ badge }: { badge: MilestoneBadge }) {
  const Icon = BADGE_ICON_MAP[badge.icon];
  return (
    <div className="rounded-2xl p-3.5 card-surface">
      <div className="flex items-center gap-2.5">
        {/* Unlocked badges read as gold medals; locked stay neutral. No
            backing tile — the glyph sits bare. */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
          <Icon
            className={cn(
              "h-[22px] w-[22px]",
              badge.unlocked
                ? "text-[hsl(var(--warning))]"
                : "text-muted-foreground",
            )}
            strokeWidth={2.2}
          />
        </div>
        <span className="min-w-0 flex-1 text-[12.5px] font-semibold leading-tight text-foreground line-clamp-2">
          {badge.title}
        </span>
        {badge.unlocked && (
          <Check className="h-3.5 w-3.5 flex-shrink-0 text-[hsl(var(--health))]" />
        )}
      </div>
      {!badge.unlocked && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full surface-inset">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.round(badge.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
