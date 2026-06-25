import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { isFighter } from "@/lib/goalType";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { XpSummaryCard } from "@/components/coach/XpSummaryCard";
import { CampHeroCard } from "@/components/coach/CampHeroCard";
import { CampActivityFeed } from "@/components/coach/CampActivityFeed";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useSubscription } from "@/hooks/useSubscription";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { PostFightDebrief } from "@/components/fightcamp/PostFightDebrief";
import { MasterySpine } from "@/components/mastery/MasterySpine";
import { MasteredShelf } from "@/components/mastery/MasteredShelf";

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
    title: "Weight Protocol",
    description: "Fight-week cut plan and hour-by-hour rehydration timeline",
    url: "/weight-protocol",
    icon: "scaleOutline",
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
  {
    title: "Recovery",
    description: "",
    url: "/recovery",
    icon: "pulseOutline",
    primary: true,
  },
];

// Tile size class, controls layout span + icon/typography scale per bento slot.
type TileSize = "hero" | "medium" | "small" | "wide";

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
  const { checkFeatureAccess, isSubscriptionResolved } =
    useSubscription();
  // Recovery is a Pro feature. Only treat a user as locked once the
  // subscription state has resolved, so paid users never flash the lock.
  const recoveryLocked =
    isSubscriptionResolved && !checkFeatureAccess("RECOVERY");
  const goalType = (profile?.goal_type as "cutting" | "losing") ?? "cutting";
  const fighter = isFighter(goalType);

  // Goal weight still gates the camp progress source (days-left / pace math).
  const goalWeightKg =
    profile?.fight_week_target_kg ?? profile?.goal_weight_kg ?? 0;

  const activeCamp = useQuery(
    api.fight_camp.getActiveCamp,
    userId ? {} : "skip",
  );

  // Cut/weight-loss plan summary, surfaces a tappable card linking to the
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
      // Rehydrating an existing plan must not arm the dashboard's unseen-plan
      // redirect guard, mark it seen unless onboarding deliberately cleared it.
      if (!localStorage.getItem("wcw_cut_plan_seen")) {
        localStorage.setItem("wcw_cut_plan_seen", "true");
      }
      setCutPlanSummary(readSummaryFromRaw(JSON.stringify(dbPlan)));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loadCutPlan]);

  const visible = useMemo(
    () => sections.filter((s) => !s.fighterOnly || fighter),
    [fighter],
  );

  // Progress bar maths, start from camp _creationTime, end at fightDate.
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

  // Progression source for the phase timeline + weight-vs-plan trajectory.
  // Prefer a real active camp; otherwise fall back to a fighter's weigh-in
  // date + cut-plan length so the panel still renders for users who haven't
  // created a formal fight-camp record yet.
  const progressSource = (() => {
    if (campProgress && activeCamp) {
      return {
        startMs: activeCamp._creationTime,
        fightMs: new Date(activeCamp.fightDate).getTime(),
        daysLeft: campProgress.daysLeft,
        pct: campProgress.pct,
      };
    }
    const targetDate = profile?.target_date;
    if (fighter && targetDate && goalWeightKg > 0) {
      const fightMs = new Date(targetDate).getTime();
      const nowMs = Date.now();
      if (isNaN(fightMs) || fightMs <= nowMs) return null;
      const weeks = cutPlanSummary?.totalWeeks ?? 8;
      const startMs = fightMs - weeks * 7 * 86_400_000;
      const total = Math.max(1, fightMs - startMs);
      const daysLeft = Math.max(0, Math.round((fightMs - nowMs) / 86_400_000));
      const pct = Math.min(1, Math.max(0, (nowMs - startMs) / total));
      return { startMs, fightMs, daysLeft, pct };
    }
    return null;
  })();

  // ── Bento layout selection ────────────────────────────────────────────
  // The Training Calendar is always the headline action and anchors the grid
  // as the full-width hero tile, regardless of whether a camp is scheduled,
  // so the bento layout stays consistent across camp / no-camp states.
  const tiles = useMemo<BentoTile[]>(() => {
    const heroUrl = "/training-calendar";
    const hero = visible.find((s) => s.url === heroUrl) ?? visible[0];
    const rest = visible.filter((s) => s.url !== hero?.url);

    const result: BentoTile[] = [];
    if (hero) result.push({ ...hero, size: "hero" });
    // Up to two medium tiles, remainder small. If fewer than 3 rest tiles
    // we still produce a coherent grid, the hero spans 2x2 and the rest
    // fill the right column / row below.
    rest.forEach((s, idx) => {
      result.push({ ...s, size: idx < 2 ? "medium" : "small" });
    });
    // Keep the grid a clean rectangle. The full-width hero consumes two cells,
    // so an ODD number of non-hero tiles would leave one dangling empty cell.
    // When that happens, promote the final tile to a full-width banner
    // ("wide") so the bottom row always fills. Recovery is appended last in
    // `sections` and is never the hero, so this is usually the Recovery CTA.
    const nonHeroCount = hero ? result.length - 1 : result.length;
    if (result.length > 0 && nonHeroCount % 2 === 1) {
      const last = result[result.length - 1];
      result[result.length - 1] = { ...last, size: "wide" };
    }
    return result;
  }, [visible, activeCamp]);

  // Phase drives both the hero card and the progression panel; derive it from
  // the broader progressSource so the panel still gets a phase when the user
  // has a weigh-in date but no formal camp record.
  const phase = progressSource ? derivePhase(progressSource.daysLeft) : null;

  // Whether the active-camp hero is shown. The hero now hosts the "View full
  // plan" link, so the standalone plan card below is only rendered when the
  // hero is absent (avoids showing the same link twice).
  const heroShown = !!(activeCamp && !activeCamp.isCompleted && campProgress && phase);
  const planUrl = cutPlanSummary
    ? cutPlanSummary.planType === "weight_loss"
      ? "/weight-plan"
      : "/cut-plan"
    : null;

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
    <div className="dashboard-enter-stagger space-y-4 px-5 pt-3 pb-3 sm:px-5 sm:pt-5 md:px-6 md:pt-6 md:pb-4 w-full max-w-2xl mx-auto">
      {/* Page header */}
      <header className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
        <h1 className="text-title font-semibold leading-tight">Camp</h1>
      </header>

      {/* ── Post-fight debrief (Fight Camp Coach, Phase 3). The camp page is
          the natural home for the fight-camp wrap-up; self-hides (renders
          null) unless a debrief is pending, so it sits just under the header
          to prompt a returning fighter first. ──────────────────────────── */}
      <ErrorBoundary fallback={null} silent>
        <PostFightDebrief />
      </ErrorBoundary>

      {/* ── Active camp hero, the headline camp details, first on the page
          for fighters with an active camp (name → days-left → progress ring →
          fight date → day-of-camp). ──────────────────────────────────────── */}
      {heroShown && (
        <CampHeroCard
          campName={activeCamp.name}
          campProgress={campProgress}
          phase={phase}
          onTap={() => goTo("/fight-camps")}
          onViewPlan={planUrl ? () => goTo(planUrl) : undefined}
        />
      )}

      {/* ── XP summary ("Your level"), only when there is NO active-camp
          hero. When the hero IS shown, the discipline level rings flank its
          main fight-progress ring instead, so this standalone card would be
          redundant. ──────────────────────────────────────────────────────── */}
      {userId && !(activeCamp && !activeCamp.isCompleted && campProgress && phase) && (
        <XpSummaryCard />
      )}

      {/* ── Camp plan area, progression panel + view-full-plan button.
          Wrapped in a single sentinel so the tutorial can spotlight both. */}
      <div data-tutorial="camp-plan-area" className="flex flex-col gap-3">
        {/* Quick link to the canonical plan timeline. When the active-camp
            hero is shown it already hosts this link, so only render the
            standalone card in the no-hero state. */}
        {cutPlanSummary && !heroShown && (
        <button
          type="button"
          data-tutorial="camp-full-plan"
          onClick={() =>
            goTo(cutPlanSummary.planType === "weight_loss" ? "/weight-plan" : "/cut-plan")
          }
          className="relative w-full rounded-2xl card-surface border border-primary/20 overflow-hidden p-4 flex items-center gap-3.5 card-press text-left"
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
      </div>

      {/* ── Mastery Spine: unified Training Missions + Sparring widget.
          Owns its own Pro wall (LockedMissionCard), queries, and
          per-discipline drill→spar flow. */}
      {userId && <MasterySpine userId={userId} />}

      {/* ── Bento grid of navigation tiles ─────────────────────────────── */}
      {/* auto-rows-min lets the full-width banners (Training Calendar /
          Recovery) be slimmer than the square medium tiles. */}
      <div className="grid grid-cols-2 gap-3 auto-rows-min">
        {tiles.map((tile) => {
          const isHero = tile.size === "hero";
          const isMedium = tile.size === "medium";
          // A "wide" tile is the parity filler, a full-width banner that
          // shares the hero's horizontal layout so the bottom row fills
          // cleanly when there's an odd number of non-hero tiles.
          const isWide = tile.size === "wide";
          const isBanner = isHero || isWide;

          // Layout spans. Hero/wide are full-width single-row banners (icon
          // beside title, like the "View full plan" card) so they stay
          // compact; medium and small tiles are a single cell each.
          const spanClass = isBanner
            ? "col-span-2 row-span-1"
            : "col-span-1 row-span-1";

          // Banners (Training Calendar / Recovery) are slim single-line rows;
          // medium/small tiles keep their square 6rem footprint.
          const heightClass = isBanner ? "h-[4.25rem]" : "h-24";

          // Per-size surface styling. Every tile carries the primary-tinted
          // border + gradient wash so the Camp grid reads as a single
          // unified set; the hero still pops via its 2x2 span + larger icon
          // and subtitle rather than via a stronger surface treatment.
          const surfaceClass =
            "relative card-surface border border-primary/20 overflow-hidden";

          // Uniform leading-icon size across every tile, matches the
          // "View full plan" card's icon (26) so the Camp page reads as a
          // single consistent icon set rather than three tiers of scale.
          const iconSize = 26;
          const titleClass = isHero
            ? "text-[17px] leading-tight tracking-tight"
            : isWide || isMedium
              ? "text-[16px] leading-tight tracking-tight"
              : "text-[14px] leading-tight tracking-tight";

          // Recovery is Pro-gated for free users. When locked, render the
          // crown upsell row (mirrors the Training Missions / Sparring rows)
          // instead of the normal tile, see the early return below.
          const isLockedTile = tile.url === "/recovery" && recoveryLocked;

          if (isLockedTile) {
            // Shimmering crown + "Unlock recovery" + a plain "Pro" chip (no
            // lock icon, no subtext). Tapping navigates to /recovery, whose
            // ProRouteGate shows the shared animated ProUpsellScreen.
            return (
              <button
                key={tile.url}
                type="button"
                onClick={() => goTo("/recovery")}
                className={`${spanClass} ${heightClass} flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 active:brightness-110 transition-[filter]`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <ShimmerCrownBadge size={26} />
                  <span className="text-body-sm font-semibold text-foreground truncate">
                    Unlock recovery
                  </span>
                </span>
                <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-[0.08em] text-primary shrink-0">
                  Pro
                </span>
              </button>
            );
          }

          const tileTutorialAttr: Record<string, string> = {
            "/gym": "camp-gym-tracker",
            "/training-calendar": "camp-training-calendar",
            "/weight-protocol": "camp-weight-protocol",
          };

          return (
            <button
              key={tile.url}
              type="button"
              data-tutorial={tileTutorialAttr[tile.url]}
              onClick={() => goTo(tile.url)}
              className={`${spanClass} ${heightClass} ${surfaceClass} rounded-2xl p-4 text-left card-press flex ${
                isBanner ? "flex-row items-center gap-3.5" : "flex-col"
              }`}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
              />

              {isBanner ? (
                /* Horizontal banner, icon beside title, like "View full plan",
                   so the hero/wide tile stays a compact single-row tile. */
                <>
                  <Icon
                    name={tile.icon}
                    size={iconSize}
                    className="relative text-primary/90 flex-shrink-0"
                  />
                  <div className="relative flex-1 min-w-0">
                    <p className={`font-semibold text-foreground ${titleClass}`}>
                      {tile.title}
                    </p>
                    {tile.description && (
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                        {tile.description}
                      </p>
                    )}
                  </div>
                  <Icon
                    name="chevronForwardOutline"
                    size={16}
                    className="relative text-muted-foreground/40 flex-shrink-0"
                  />
                </>
              ) : (
                <>
                  <div className="relative flex-1 flex flex-col">
                    <div className="flex-1">
                      <Icon
                        name={tile.icon}
                        size={iconSize}
                        className="text-primary/90"
                      />
                    </div>
                    <div className="mt-2">
                      <p className={`font-semibold text-foreground ${titleClass}`}>
                        {tile.title}
                      </p>
                    </div>
                  </div>

                  <Icon
                    name="chevronForwardOutline"
                    size={14}
                    className="absolute bottom-3 right-3 text-muted-foreground/40"
                  />
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Recent activity, last few events across logging surfaces.
          Component renders null when empty, so the page degrades cleanly. */}
      <ErrorBoundary silent fallback={<></>}>
        <div data-tutorial="camp-recent-activity">
          <CampActivityFeed userId={userId} limit={7} />
        </div>
      </ErrorBoundary>

      {/* ── "Mastered this camp" trophy shelf — pinned to the very bottom,
          below Recent activity, and collapsible (the user can hide it). It
          owns its own query, so it renders null when there's nothing mastered. */}
      <ErrorBoundary silent fallback={<></>}>
        <MasteredShelf />
      </ErrorBoundary>

    </div>
  );
}
