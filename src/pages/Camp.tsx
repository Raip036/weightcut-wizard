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
import { CampHeroCard } from "@/components/coach/CampHeroCard";
import { CampActivityFeed } from "@/components/coach/CampActivityFeed";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useSubscription } from "@/hooks/useSubscription";

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
  { title: "Sleep",     description: "", url: "/sleep",     icon: "moonOutline" },
  { title: "Recovery",  description: "", url: "/recovery",  icon: "heartOutline" },
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
  const { openPaywall, checkFeatureAccess, isSubscriptionResolved } =
    useSubscription();

  // Recovery is a Pro feature. Only treat a user as locked once the
  // subscription state has resolved, so paid users never flash the lock.
  const recoveryLocked =
    isSubscriptionResolved && !checkFeatureAccess("RECOVERY");
  const goalType = (profile?.goal_type as "cutting" | "losing") ?? "cutting";
  const fighter = isFighter(goalType);

  const activeCamp = useQuery(
    api.fight_camp.getActiveCamp,
    userId ? {} : "skip",
  );

  // Mission feature gating — drives whether the missions slot renders the
  // full `<MissionStack />` (Pro or has missions) or a compact upsell line
  // (non-Pro with zero missions). Mirrors MissionStack's own queries so the
  // visible component is in sync with what would have rendered.
  const missionFeature = useQuery(
    api.training_missions.getMissionFeatureStatus,
    userId ? {} : "skip",
  );
  const missions = useQuery(
    api.training_missions.getActiveMissions,
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
    <div className="dashboard-enter-stagger space-y-4 px-5 pt-3 pb-36 sm:px-5 sm:pt-5 md:px-6 md:pt-6 w-full max-w-2xl mx-auto">
      {/* Page header */}
      <header className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
        <h1 className="text-title font-semibold leading-tight">Camp</h1>
      </header>

      {/* ── XP summary — top disciplines at a glance ──────────────────── */}
      {userId && <XpSummaryCard />}

      {/* ── Active camp hero ───────────────────────────────────────────── */}
      {activeCamp && !activeCamp.isCompleted && campProgress && phase && (
        <CampHeroCard
          campName={activeCamp.name}
          campProgress={campProgress}
          phase={phase}
          onTap={() => goTo("/fight-camps")}
        />
      )}

      {/* ── Your plan — quick link to the canonical timeline ───────────── */}
      {cutPlanSummary && (
        <button
          type="button"
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

      {/* ── Training Missions — compact upsell for non-Pro zero-missions,
          full MissionStack (+heading) for Pro or anyone with active missions. */}
      {userId && missionFeature !== undefined && missions !== undefined && (
        !missionFeature.isPro ? (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(ImpactStyle.Light);
              openPaywall();
            }}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl card-surface active:brightness-110 transition-[filter]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Icon name="sparklesOutline" size={14} className="text-primary shrink-0" />
              <span className="text-body-sm text-foreground truncate">Pro: Unlock training missions</span>
            </span>
            <Icon name="arrowForwardOutline" size={12} className="text-muted-foreground" />
          </button>
        ) : (
          <>
            <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80 pt-2">
              Training missions
            </h2>
            <MissionStack />
          </>
        )
      )}

      {/* ── Bento grid of navigation tiles ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 auto-rows-[6rem]">
        {tiles.map((tile) => {
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
            ? "text-[20px] leading-tight tracking-tight"
            : isMedium
              ? "text-[16px] leading-tight tracking-tight"
              : "text-[14px] leading-tight tracking-tight";

          // Recovery is Pro-gated: free users get the paywall + a PRO chip
          // instead of navigating into the (now locked) Recovery page.
          const isLockedTile = tile.url === "/recovery" && recoveryLocked;

          return (
            <button
              key={tile.url}
              type="button"
              onClick={() => {
                if (isLockedTile) {
                  triggerHaptic(ImpactStyle.Light);
                  openPaywall();
                  return;
                }
                goTo(tile.url);
              }}
              className={`${spanClass} ${surfaceClass} rounded-2xl p-4 text-left card-press flex flex-col`}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
              />

              {/* PRO chip — flags the tile as gated for free users. */}
              {isLockedTile && (
                <span className="absolute top-2.5 right-2.5 z-10 inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-primary">
                  <Icon name="lockClosed" size={9} />
                  Pro
                </span>
              )}

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
                  {isHero && tile.description && (
                    <p className="text-note text-muted-foreground leading-snug mt-1 truncate">
                      {tile.description}
                    </p>
                  )}
                </div>
              </div>

              <Icon
                name={isLockedTile ? "lockClosedOutline" : "chevronForwardOutline"}
                size={14}
                className="absolute bottom-3 right-3 text-muted-foreground/40"
              />
            </button>
          );
        })}
      </div>

      {/* ── Recent activity — last few events across logging surfaces.
          Component renders null when empty, so the page degrades cleanly. */}
      <ErrorBoundary silent fallback={<></>}>
        <CampActivityFeed userId={userId} limit={7} />
      </ErrorBoundary>
    </div>
  );
}
