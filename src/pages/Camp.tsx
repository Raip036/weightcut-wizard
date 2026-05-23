import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { isFighter } from "@/lib/goalType";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { MissionStack } from "@/components/coach/MissionStack";
import { XpSummaryCard } from "@/components/coach/XpSummaryCard";

interface CampSection {
  title: string;
  description: string;
  url: string;
  icon: IonIconName;
  fighterOnly?: boolean;
  primary?: boolean;
  utility?: boolean;
}

const sections: CampSection[] = [
  {
    title: "Training Calendar",
    description: "",
    url: "/training-calendar",
    icon: "calendarOutline",
    primary: true,
  },
  {
    title: "Fight Camps",
    description: "Manage camps and plan your preparation phases",
    url: "/fight-camps",
    icon: "trophyOutline",
    fighterOnly: true,
    primary: true,
  },
  {
    title: "Gym Tracker",
    description: "Log gym sessions, track exercises and monitor volume",
    url: "/gym",
    icon: "barbellOutline",
    primary: true,
  },
  {
    title: "Weight Cut Protocol",
    description: "Manage your cut and rehydration strategy for fight week",
    url: "/weight-cut",
    icon: "waterOutline",
    fighterOnly: true,
    primary: true,
  },
  {
    title: "Training Library",
    description: "Browse drills, techniques and training resources",
    url: "/training-library",
    icon: "bookOutline",
    utility: true,
  },
];

// Tile size class — controls layout span + icon/typography scale per bento slot.
type TileSize = "hero" | "medium" | "small";

interface BentoTile extends CampSection {
  size: TileSize;
}

// Phase chip mapping derived purely from days-left.
function derivePhase(daysLeft: number): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  if (daysLeft <= 7) {
    return {
      label: "Fight Week",
      bg: "bg-red-500/15",
      text: "text-red-400",
      border: "border-red-500/25",
    };
  }
  if (daysLeft <= 14) {
    return {
      label: "Peak",
      bg: "bg-amber-500/15",
      text: "text-amber-400",
      border: "border-amber-500/25",
    };
  }
  return {
    label: "Build",
    bg: "bg-primary/15",
    text: "text-primary",
    border: "border-primary/25",
  };
}

export default function Camp() {
  const navigate = useNavigate();
  const { profile, userId, loadCutPlan } = useUser();
  const goalType = (profile?.goal_type as "cutting" | "losing") ?? "cutting";
  const fighter = isFighter(goalType);

  const activeCamp = useQuery(
    api.fight_camp.getActiveCamp,
    userId ? {} : "skip",
  );

  // Cut/weight-loss plan summary — surfaces a tappable card linking to the
  // canonical plan timeline. Moved here from the Goals (profile) page so the
  // plan lives alongside the rest of the camp dashboard.
  const readSummaryFromRaw = (raw: string | null) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const last = parsed?.weeklyPlan?.[parsed.weeklyPlan.length - 1];
      if (!parsed?.totalWeeks || !parsed?.weeklyLossTarget) return null;
      return {
        totalWeeks: parsed.totalWeeks,
        weeklyLossTarget: parsed.weeklyLossTarget,
        goalWeight: parsed.goalWeight ?? last?.targetWeight ?? 0,
        planType: (parsed.planType === "weight_loss" ? "weight_loss" : "weight_cut") as
          | "weight_loss"
          | "weight_cut",
      };
    } catch { return null; }
  };

  // Lazy-init from localStorage so the tile renders fully-populated on
  // first paint instead of mounting empty and popping in after the effect
  // runs. The DB fallback below still fills it for fresh installs.
  const [cutPlanSummary, setCutPlanSummary] = useState<{
    totalWeeks: number;
    weeklyLossTarget: string;
    goalWeight: number;
    planType: "weight_loss" | "weight_cut";
  } | null>(() => {
    if (typeof window === "undefined") return null;
    return readSummaryFromRaw(window.localStorage.getItem("wcw_cut_plan"));
  });

  useEffect(() => {
    // If the localStorage read already populated state on mount, skip the
    // DB round-trip. Otherwise fetch from Convex and cache.
    if (cutPlanSummary) return;
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const dbPlan = await loadCutPlan();
      if (cancelled || !dbPlan?.weeklyPlan) return;
      localStorage.setItem("wcw_cut_plan", JSON.stringify(dbPlan));
      setCutPlanSummary(readSummaryFromRaw(JSON.stringify(dbPlan)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loadCutPlan]);

  const visible = useMemo(
    () => sections.filter((s) => !s.fighterOnly || fighter),
    [fighter],
  );

  // Progress bar maths — start from camp _creationTime, end at fightDate.
  const campProgress = (() => {
    if (!activeCamp || activeCamp.isCompleted) return null;
    const startMs = activeCamp._creationTime;
    const fightMs = new Date(activeCamp.fightDate).getTime();
    const nowMs = Date.now();
    const totalDays = Math.max(1, Math.round((fightMs - startMs) / 86_400_000));
    const elapsed = Math.max(0, Math.round((nowMs - startMs) / 86_400_000));
    const daysLeft = Math.max(0, Math.round((fightMs - nowMs) / 86_400_000));
    const pct = Math.min(1, elapsed / totalDays);
    const fightLabel = new Date(activeCamp.fightDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return { totalDays, elapsed, daysLeft, pct, fightLabel };
  })();

  // ── Bento layout selection ────────────────────────────────────────────
  // Pick the hero tile based on user state: active-camp fighters get the
  // Training Calendar as their headline action; everyone else gets the Gym
  // Tracker (the closest universal "do something now" surface).
  const tiles = useMemo<BentoTile[]>(() => {
    const heroUrl =
      activeCamp && !activeCamp.isCompleted
        ? "/training-calendar"
        : "/gym";
    const hero = visible.find((s) => s.url === heroUrl) ?? visible[0];
    const rest = visible.filter((s) => s.url !== hero?.url);

    const result: BentoTile[] = [];
    if (hero) result.push({ ...hero, size: "hero" });
    // Up to two medium tiles, remainder small. If fewer than 3 rest tiles
    // we still produce a coherent grid — the hero spans 2x2 and the rest
    // fill the right column / row below.
    rest.forEach((s, idx) => {
      result.push({ ...s, size: idx < 2 ? "medium" : "small" });
    });
    return result;
  }, [visible, activeCamp]);

  const phase = campProgress ? derivePhase(campProgress.daysLeft) : null;

  // Tap handler with haptic feedback. Centralised so the bento + cut-plan
  // tiles share the same interaction language.
  const goTo = (url: string) => {
    triggerHaptic(ImpactStyle.Light);
    navigate(url);
  };

  return (
    // PageTransition drives a single page-level fade; tiles render statically
    // so we don't compose a per-tile cascade on top of it. A faster, simpler
    // entrance than the previous staggered framer-motion sequence.
    <div className="animate-page-in space-y-4 px-5 pt-3 pb-28 sm:px-5 sm:pt-5 md:px-6 md:pt-6 w-full max-w-2xl mx-auto">
      {/* Page header */}
      <header className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
        <h1 className="text-title font-semibold leading-tight">Camp</h1>
      </header>

      {/* ── XP summary — top disciplines at a glance ──────────────────── */}
      {userId && <XpSummaryCard />}

      {/* ── Active camp hero ───────────────────────────────────────────── */}
      {activeCamp && !activeCamp.isCompleted && campProgress && phase && (
        <div className="relative">
          {/* Aurora ambient glow — subtle radial behind the hero. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-4 -inset-y-4 rounded-[2rem] opacity-70 blur-3xl"
            style={{
              background:
                "radial-gradient(60% 60% at 30% 40%, hsl(var(--primary) / 0.18), hsl(var(--primary) / 0.05) 50%, transparent 75%)",
            }}
          />
          <button
            type="button"
            onClick={() => goTo("/fight-camps")}
            className="relative w-full text-left rounded-2xl border border-primary/20 bg-primary/10 p-4 active:scale-[0.99] transition-transform overflow-hidden"
          >
            {/* Faint inner gradient wash to lift the hero off the page. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent"
            />

            <div className="relative">
              {/* Top row: name + phase chip on the left, days-left on the right */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon name="flagOutline" size={12} className="text-primary shrink-0" />
                    <p className="text-micro uppercase tracking-wider text-primary/80 font-semibold">
                      Active Camp
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[22px] font-bold leading-tight truncate min-w-0">
                      {activeCamp.name}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] border ${phase.bg} ${phase.text} ${phase.border}`}
                    >
                      {phase.label}
                    </span>
                  </div>
                </div>
                <div className="text-center shrink-0 bg-primary/10 rounded-xl px-3 py-2">
                  <p className="text-[28px] font-extrabold tabular-nums text-foreground leading-none">
                    {campProgress.daysLeft}
                  </p>
                  <p className="text-micro uppercase tracking-wider text-foreground font-bold mt-0.5">
                    days left
                  </p>
                </div>
              </div>

              {/* Progress bar with smoother gradient fill */}
              <div className="space-y-2">
                <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
                    style={{ width: `${campProgress.pct * 100}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <p className="text-micro text-foreground font-bold tabular-nums">
                    Day {campProgress.elapsed} of {campProgress.totalDays}
                  </p>
                  <p className="text-micro text-muted-foreground font-semibold">
                    Fight: <span className="text-foreground font-bold">{campProgress.fightLabel}</span>
                  </p>
                </div>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* ── Your plan — quick link to the canonical timeline ───────────── */}
      {cutPlanSummary && (
        <button
          type="button"
          onClick={() =>
            goTo(cutPlanSummary.planType === "weight_loss" ? "/weight-plan" : "/cut-plan")
          }
          className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden p-4 flex items-center gap-3.5 active:scale-[0.99] transition-all text-left"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
          />
          <Icon name="documentTextOutline" size={26} className="relative text-primary flex-shrink-0" />
          <div className="relative flex-1 min-w-0">
            <p className="text-body-sm font-semibold text-foreground leading-tight">
              View full plan
            </p>
          </div>
          <Icon name="chevronForwardOutline" size={16} className="relative text-muted-foreground/40 flex-shrink-0" />
        </button>
      )}

      {/* ── Training Missions (notes-driven, per-discipline checklists) ──
          Glow lives on the LockedMissionCard surface itself (primary tint +
          border), no ambient halo around the widget. */}
      {userId && <MissionStack />}

      {/* ── Bento grid of navigation tiles ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 auto-rows-[6rem]">
        {tiles.map((tile, i) => {
          const isHero = tile.size === "hero";
          const isMedium = tile.size === "medium";

          // Layout spans. Hero is 2x2; medium tiles are 1x2 (taller); small
          // tiles are a single cell.
          const spanClass = isHero
            ? "col-span-2 row-span-2"
            : isMedium
              ? "col-span-1 row-span-2"
              : "col-span-1 row-span-1";

          // Per-size surface styling. Every tile carries the primary-tinted
          // border + gradient wash so the Camp grid reads as a single
          // unified set; the hero still pops via its 2x2 span + larger icon
          // and subtitle rather than via a stronger surface treatment.
          const surfaceClass =
            "relative card-surface border border-primary/20 overflow-hidden";

          const iconSize = isHero ? 56 : isMedium ? 40 : 32;
          const titleClass = isHero
            ? "text-[20px] leading-tight"
            : isMedium
              ? "text-[16px] leading-tight"
              : "text-[14px] leading-tight";

          return (
            <button
              key={tile.url}
              type="button"
              onClick={() => goTo(tile.url)}
              className={`${spanClass} ${surfaceClass} rounded-2xl p-4 text-left active:scale-[0.99] transition-transform flex flex-col`}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
              />

              <div className="relative flex-1 flex flex-col">
                <div className="flex-1">
                  <Icon
                    name={tile.icon}
                    size={iconSize}
                    className="text-primary"
                  />
                </div>
                <div className="mt-2">
                  <p className={`font-semibold text-foreground ${titleClass}`}>
                    {tile.title}
                  </p>
                  {isHero && tile.description && (
                    <p className="text-note text-muted-foreground leading-snug mt-1 truncate">
                      {tile.description}
                    </p>
                  )}
                </div>
              </div>

              <Icon
                name="chevronForwardOutline"
                size={14}
                className="absolute bottom-3 right-3 text-muted-foreground/40"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
