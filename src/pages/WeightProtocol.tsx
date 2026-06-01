// WP-T20 — WeightProtocol page assembly.
//
// Single scroll, 13 sections per spec §7.1. Pulls everything from
// `api.weightProtocols.getCurrentForUser`, which returns either:
//   • `undefined`  → query still hydrating (skeleton)
//   • `null`       → no active fight camp (empty state)
//   • `{ campId, phase, today, daysToWeighIn, fightPlan, rehydration,
//      feelChecks, ... }` → full page.
//
// All sub-components (`WP-T10..WP-T19`) are dumb / presentational; this
// page owns the data fetch, the approach selector local state, and the
// regenerate action.
import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";

import { ProtocolHeader } from "@/components/protocol/ProtocolHeader";
import { InputsUsedChips } from "@/components/protocol/InputsUsedChips";
import {
  CutApproachSelector,
  type CutApproach,
} from "@/components/protocol/CutApproachSelector";
import { TodaysActionHero } from "@/components/protocol/TodaysActionHero";
import { SafetyWarningBanner } from "@/components/protocol/SafetyWarningBanner";
import { FightPlanDayCard } from "@/components/protocol/FightPlanDayCard";
import { LockedDayCard } from "@/components/protocol/LockedDayCard";
import { WeightLossBreakdownChart } from "@/components/protocol/WeightLossBreakdownChart";
import { WeighInDaySpotlight } from "@/components/protocol/WeighInDaySpotlight";
import { OrsRecipeCard } from "@/components/protocol/OrsRecipeCard";
import { RehydrationHourRow } from "@/components/protocol/RehydrationHourRow";
import { RehydrationTimelinePlaceholder } from "@/components/protocol/RehydrationTimelinePlaceholder";
import { DoNotCallouts } from "@/components/protocol/DoNotCallouts";
import {
  FeelChecksList,
  type FeelCheckMetric,
} from "@/components/protocol/FeelChecksList";
import { ProtocolRegenerateButton } from "@/components/protocol/ProtocolRegenerateButton";
import { BackToTopFAB } from "@/components/protocol/BackToTopFAB";
import { ProtocolSectionDivider } from "@/components/protocol/ProtocolSectionDivider";
import { ProtocolPageSkeleton } from "@/components/protocol/ProtocolPageSkeleton";
import { NoFightCampEmptyState } from "@/components/protocol/NoFightCampEmptyState";
import { ProtocolGenerationError } from "@/components/protocol/ProtocolGenerationError";

// Lifecycle phase mirrors `TodaysActionHero.ProtocolPhase`. Server is the
// canonical source — page-level type alias keeps the file readable.
type Phase = "prep" | "cut" | "weigh-in" | "refeed" | "pre-fight";

// Daily regen budget — UI hint only; the action itself is rate-limited
// server-side via `weight_protocols_internal.gatherInputs`. Kept here so
// the button can render its "1/1 today" badge.
const REGEN_DAILY_LIMIT = 1;
// Free users see the first N days of the cut; everything past T-(N-1)
// collapses into the LockedDayCard.
const FREE_VISIBLE_COUNT = 2;
// Default weigh-in clock time when the camp doesn't carry one. The page
// uses this only for the spotlight + timeline placeholder; deterministic
// math (phase, daysToWeighIn) lives on the server.
const DEFAULT_WEIGH_IN_CLOCK = "11:00";

// Feel-check metric → display strings. Lives in-file (rather than in the
// component) so server-known metrics can be filtered/relabelled without
// touching FeelChecksList itself.
const FEEL_CHECK_METRICS: ReadonlyArray<FeelCheckMetric> = [
  "urine_colour",
  "weigh_back_kg",
  "energy_1to10",
  "headache",
  "no_cramps",
];
const FEEL_CHECK_COPY: Record<FeelCheckMetric, { label: string; target: string }> = {
  urine_colour: { label: "Urine colour", target: "pale straw" },
  weigh_back_kg: { label: "Weight rebound on track", target: "+80–100% of cut" },
  energy_1to10: { label: "Energy ≥ 6 / 10", target: "" },
  headache: { label: "No headache", target: "" },
  no_cramps: { label: "No cramps", target: "" },
};

export default function WeightProtocol() {
  const { userId, profile } = useUser();
  const { isPremium } = useSubscription();

  // Single page-level query. Returns `undefined` while loading, `null`
  // when there's no active camp, and the protocol bundle otherwise.
  const protocol = useQuery(
    api.weightProtocols.getCurrentForUser,
    userId ? {} : "skip",
  );

  // Approach selector is a *local* mirror of the server value. We reset
  // it whenever the server-side fightPlan row changes (id-keyed) so a
  // background regen elsewhere doesn't get stomped by stale local state.
  const [approach, setApproach] = useState<CutApproach>(
    (protocol?.fightPlan?.approach as CutApproach | undefined) ?? "standard",
  );
  useEffect(() => {
    const next = protocol?.fightPlan?.approach as CutApproach | undefined;
    if (next) setApproach(next);
    // Tracking the fightPlan _id (not the approach itself) means user
    // taps don't trigger this effect — only server-state changes do.
  }, [protocol?.fightPlan?._id, protocol?.fightPlan?.approach]);

  // Regenerate action — runs fight plan + rehydration sequentially so we
  // can surface the first failing step's error without orphaning state.
  const generateFightPlan = useAction(api.actions.generateFightPlan.run);
  const generateRehydration = useAction(
    api.actions.generateRehydrationProtocol.run,
  );
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [usedToday, setUsedToday] = useState(0);

  const handleRegenerate = useCallback(async () => {
    if (!protocol?.campId) return;
    setIsRegenerating(true);
    setGenError(null);
    try {
      await generateFightPlan({ campId: protocol.campId, approach });
      await generateRehydration({ campId: protocol.campId });
      setUsedToday((n) => n + 1);
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Generation failed. Please try again.";
      setGenError(msg);
    } finally {
      setIsRegenerating(false);
    }
  }, [protocol?.campId, approach, generateFightPlan, generateRehydration]);

  // Approach taps update local state only — the user must hit Regenerate
  // to commit. Avoids burning a daily generation on every accidental tap.
  const handleApproachChange = useCallback((next: CutApproach) => {
    setApproach(next);
  }, []);

  // ── Top-level states ──────────────────────────────────────────────
  if (protocol === undefined) return <ProtocolPageSkeleton />;
  if (protocol === null) return <NoFightCampEmptyState />;

  // ── Destructure once for readability ──────────────────────────────
  const {
    phase,
    today,
    daysToWeighIn,
    fightPlan,
    rehydration,
    feelChecks,
    campId,
  } = protocol;
  const phaseTyped = phase as Phase;
  // `payload` is `Infer<FightPlanSchema>` / `Infer<RehydrationProtocolSchema>`
  // server-side but loosely-typed at the api boundary; we narrow with
  // explicit `as any` casts at the call sites that need it.
  const fpPayload = (fightPlan?.payload as any) ?? null;
  const rhPayload = (rehydration?.payload as any) ?? null;

  // ── Header: cut depth / category / countdown ──────────────────────
  const cutDepthPct = (fpPayload?.cutDepthPct as number | undefined) ?? 0;
  const cutCategory =
    (fpPayload?.cutCategory as
      | "light"
      | "moderate"
      | "heavy"
      | "extreme"
      | undefined) ?? "moderate";

  // ── Inputs-used chips (Tuned to you) ──────────────────────────────
  const currentWeight = profile?.current_weight_kg ?? 0;
  const cutDepthKg = (fpPayload?.cutDepthKg as number | undefined) ?? 0;
  const targetWeight = currentWeight && cutDepthKg
    ? currentWeight - cutDepthKg
    : 0;
  const gapHours =
    (rhPayload?.weighInToFightGapHours as number | undefined) ?? null;

  const inputChips = [
    {
      label: `${cutDepthKg ? cutDepthKg.toFixed(1) : "—"}kg cut`,
      tone: "accent" as const,
    },
    {
      label: `${currentWeight.toFixed(1)}kg → ${targetWeight.toFixed(1)}kg`,
    },
    { label: `${gapHours ?? "—"}h weigh-in→fight` },
    {
      label: `${profile?.sex === "female" ? "Female" : "Male"} · ${profile?.age ?? "—"} yrs`,
    },
  ];

  // ── Today's hero (TodaysActionHero) ───────────────────────────────
  const days = (fpPayload?.days as any[] | undefined) ?? [];
  const todayDay = days.find((d) => d.dayIso === today) ?? null;
  const tier: "green" | "amber" | "red" =
    cutCategory === "extreme" ? "red" : cutCategory === "heavy" ? "amber" : "green";
  const heroHeadline =
    (todayDay?.keyAction as string | undefined) ?? "Loading your plan…";
  const heroBody = (todayDay?.carbsCopy as string | undefined) ?? "";
  const heroMetrics = todayDay
    ? [
        { label: "Carbs", value: `${todayDay.carbsGrams}g` },
        { label: "Water", value: `${(todayDay.waterLitres as number).toFixed(1)}L` },
        {
          label: "Sodium",
          value:
            (todayDay.sodiumMg as number) < 1000
              ? `${todayDay.sodiumMg}mg`
              : `${((todayDay.sodiumMg as number) / 1000).toFixed(1)}g`,
        },
        {
          label: "Fibre",
          value: String(todayDay.fibreNote).replace(/_/g, " "),
        },
      ]
    : [];

  // ── Safety warnings — only the highest severity wins, top of stack ─
  const warnings =
    (fpPayload?.safetyWarnings as
      | { severity: "info" | "warn" | "critical"; code: string; message: string }[]
      | undefined) ?? [];
  const critical = warnings.find((w) => w.severity === "critical");
  const warn = warnings.find((w) => w.severity === "warn");

  // ── Fight-plan list: free split / locked tail ─────────────────────
  // Premium sees the full list; free sees the first N days, with the
  // tail folded into a single LockedDayCard.
  const freeVisibleDays = isPremium ? days : days.slice(0, FREE_VISIBLE_COUNT);
  const lockedDays = isPremium ? [] : days.slice(FREE_VISIBLE_COUNT);

  // ── Weight-loss breakdown ─────────────────────────────────────────
  const expLoss =
    (fpPayload?.expectedWeightLossKg as
      | { glycogen: number; water: number; gut: number; fat: number; total: number }
      | undefined) ?? null;
  const breakdownSegments = expLoss
    ? ([
        { label: "Glycogen", kg: expLoss.glycogen, tone: "primary" },
        { label: "Water load", kg: expLoss.water, tone: "blue" },
        { label: "Gut content", kg: expLoss.gut, tone: "amber" },
        { label: "Fat", kg: expLoss.fat, tone: "muted" },
      ] as const)
    : [];

  // ── Weigh-in day spotlight ─────────────────────────────────────────
  const weighInDay = days.find((d) => d.daysToWeighIn === 0) ?? null;

  // ── Rehydration timeline ──────────────────────────────────────────
  const hours = (rhPayload?.hours as any[] | undefined) ?? [];
  // v1 simplification: until we have a confirmed weigh-in clock time on
  // the camp, treat all hours as "future" so the timeline renders as a
  // forward-looking plan rather than a stale current-hour highlight.
  const currentHourOffset = -1;

  // ── Feel-checks ────────────────────────────────────────────────────
  const feelCheckList = FEEL_CHECK_METRICS.map((metric) => {
    const server = feelChecks.find((c) => c.metric === metric);
    return {
      metric,
      label: FEEL_CHECK_COPY[metric].label,
      target: FEEL_CHECK_COPY[metric].target,
      done: !!server,
      loggedAt: server?.checkedAt,
    };
  });

  // ── Approach selector lock — too close to weigh-in to change track ─
  const approachLocked = daysToWeighIn <= 2;

  return (
    <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
      {/* 1. Header */}
      <ProtocolHeader
        cutDepthPct={cutDepthPct}
        cutCategory={cutCategory}
        daysToWeighIn={daysToWeighIn}
        weighInDate={null}
      />

      {/* 2. Today's action */}
      <TodaysActionHero
        phase={phaseTyped}
        headline={heroHeadline}
        body={heroBody}
        metrics={heroMetrics}
        tier={tier}
        breathPulse={phaseTyped === "weigh-in"}
      />

      {/* 3. Safety warnings — highest severity only */}
      {critical && (
        <SafetyWarningBanner
          level="red"
          title={critical.code.replace(/_/g, " ")}
          body={critical.message}
        />
      )}
      {!critical && warn && (
        <SafetyWarningBanner
          level="amber"
          title={warn.code.replace(/_/g, " ")}
          body={warn.message}
        />
      )}

      {/* 4. Inputs-used chips */}
      <InputsUsedChips chips={inputChips} />

      {/* 5. Cut-approach selector */}
      <CutApproachSelector
        value={approach}
        onChange={handleApproachChange}
        disabled={approachLocked}
        disabledReason={
          approachLocked
            ? "Too late to change approach this close to weigh-in"
            : undefined
        }
      />

      {/* 6. Fight plan day list */}
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold pt-2">
        Fight plan
      </div>
      <div className="space-y-2.5">
        {freeVisibleDays.map((d: any, i: number) => (
          <FightPlanDayCard
            key={d.dayIso}
            day={d}
            state={
              d.dayIso === today
                ? "today"
                : d.daysToWeighIn < daysToWeighIn
                  ? "past"
                  : "future"
            }
            index={i}
          />
        ))}
        {lockedDays.length > 0 && <LockedDayCard days={lockedDays} />}
      </div>

      {/* 7. Weight-loss breakdown chart */}
      {breakdownSegments.length > 0 && expLoss && (
        <WeightLossBreakdownChart
          totalKg={expLoss.total}
          segments={[...breakdownSegments]}
        />
      )}

      {/* 8. Weigh-in day spotlight (premium) / locked teaser (free) */}
      {weighInDay && isPremium && (
        <WeighInDaySpotlight
          weighInTime={DEFAULT_WEIGH_IN_CLOCK}
          entries={[
            { time: "06:00", label: "Weight check", iconName: "scaleOutline" },
            {
              time: "09:00",
              label: "Final sauna IF needed",
              iconName: "flameOutline",
            },
            { time: DEFAULT_WEIGH_IN_CLOCK, label: "ON-STAGE", highlight: true },
            {
              time: "11:01",
              label: "First food + ORS",
              iconName: "restaurantOutline",
            },
          ]}
        />
      )}
      {weighInDay && !isPremium && <LockedDayCard days={[weighInDay]} />}

      {/* 9. Section divider */}
      <ProtocolSectionDivider label="After the scale" />

      {/* 10. ORS recipe + 11. rehydration hourly timeline (premium) */}
      {isPremium && rhPayload && (
        <>
          <OrsRecipeCard
            perLitre={rhPayload.orsRecipe?.perLitre ?? []}
            totalLitresTarget={rhPayload.orsRecipe?.totalLitresTarget ?? 0}
            diyShoppingList={rhPayload.orsRecipe?.diyShoppingList ?? []}
            commercialEquivalents={
              rhPayload.orsRecipe?.commercialEquivalents ?? []
            }
          />

          {phaseTyped === "refeed" || phaseTyped === "pre-fight" ? (
            <div className="space-y-2" role="list">
              {hours.map((h: any, i: number) => (
                <RehydrationHourRow
                  key={h.hourOffset}
                  hour={h}
                  state={
                    h.hourOffset === currentHourOffset
                      ? "current"
                      : h.hourOffset < currentHourOffset
                        ? "past"
                        : "future"
                  }
                  index={i}
                />
              ))}
            </div>
          ) : (
            <RehydrationTimelinePlaceholder weighInTime={DEFAULT_WEIGH_IN_CLOCK} />
          )}
        </>
      )}
      {!isPremium && (
        // Single locked card stands in for the full rehydration section
        // for free users — keeps the page silhouette consistent.
        <LockedDayCard days={[]} />
      )}

      {/* 12. Do-not callouts */}
      <DoNotCallouts items={(rhPayload?.doNots as string[] | undefined) ?? []} />

      {/* 13. Feel checks */}
      <FeelChecksList campId={campId} checks={feelCheckList} />

      {/* Regenerate button + error */}
      <ProtocolRegenerateButton
        onRegenerate={handleRegenerate}
        usedToday={usedToday}
        limit={REGEN_DAILY_LIMIT}
        isLoading={isRegenerating}
      />
      {genError && (
        <ProtocolGenerationError error={genError} onRetry={handleRegenerate} />
      )}

      {/* Floating back-to-top */}
      <BackToTopFAB />
    </div>
  );
}
