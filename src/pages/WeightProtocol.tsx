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
import { Icon } from "@/components/ui/Icon";

import { ProtocolHeader } from "@/components/protocol/ProtocolHeader";
import {
  InputsUsedChips,
  type InputStat,
} from "@/components/protocol/InputsUsedChips";
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
  type FeelCheck,
  type FeelCheckMetric,
} from "@/components/protocol/FeelChecksList";
import { ProtocolRegenerateButton } from "@/components/protocol/ProtocolRegenerateButton";
import { BackToTopFAB } from "@/components/protocol/BackToTopFAB";
import { ProtocolSectionDivider } from "@/components/protocol/ProtocolSectionDivider";
import { ProtocolPageSkeleton } from "@/components/protocol/ProtocolPageSkeleton";
import { NoFightCampEmptyState } from "@/components/protocol/NoFightCampEmptyState";
import { ProtocolGenerationError } from "@/components/protocol/ProtocolGenerationError";
import { ProtocolGeneratingOverlay } from "@/components/protocol/ProtocolGeneratingOverlay";

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

// Canonical metric order. Labels / icons / sheet copy now live inside
// FeelChecksList so the page just passes server values through.
const FEEL_CHECK_METRICS: ReadonlyArray<FeelCheckMetric> = [
  "urine_colour",
  "weigh_back_kg",
  "energy_1to10",
  "headache",
  "no_cramps",
];

export default function WeightProtocol() {
  const { userId, profile } = useUser();
  const { isPremium, openPaywall } = useSubscription();

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

  // ── Raw derived values from the server (work even pre-generation) ──
  // The server query computes these from camp + latest weight log + profile
  // so the page can render the cut-depth header pill and the "Tuned to you"
  // stat grid the moment a fight camp exists. AI payload values take
  // precedence when present (they're the canonical engine output); we fall
  // back to server-derived raw otherwise.
  const rawCutDepthKg =
    (protocol.cutDepthKg as number | null | undefined) ?? null;
  const rawCutDepthPct =
    (protocol.cutDepthPct as number | null | undefined) ?? null;
  const rawCurrentWeight =
    (protocol.currentWeightKg as number | null | undefined) ??
    profile?.current_weight_kg ??
    null;
  const rawTargetWeight =
    (protocol.targetWeightKg as number | null | undefined) ?? null;
  const rawGapHours =
    (protocol.weighInToFightGapHours as number | null | undefined) ?? null;

  // ── Header: cut depth / category / countdown ──────────────────────
  // Prefer AI payload; fall back to server-derived raw so the pill is
  // never stuck at 0% before generation.
  const cutDepthPct =
    (fpPayload?.cutDepthPct as number | undefined) ?? rawCutDepthPct ?? 0;
  const cutCategory =
    (fpPayload?.cutCategory as
      | "light"
      | "moderate"
      | "heavy"
      | "extreme"
      | undefined) ??
    (rawCutDepthPct == null
      ? "moderate"
      : rawCutDepthPct < 2
        ? "light"
        : rawCutDepthPct < 4
          ? "moderate"
          : rawCutDepthPct < 6
            ? "heavy"
            : "extreme");

  // ── Inputs-used stats (Tuned to you) ──────────────────────────────
  // Labeled stat grid replaces the older chip row — see InputsUsedChips
  // for the visual; this block just builds the data, with each stat
  // guarded so missing server values render as "—" rather than NaN.
  const cutDepthKgRaw =
    (fpPayload?.cutDepthKg as number | undefined) ?? rawCutDepthKg ?? null;
  const cutDepthPctRaw =
    (fpPayload?.cutDepthPct as number | undefined) ?? rawCutDepthPct ?? null;
  const currentWeight = rawCurrentWeight ?? 0;
  const targetWeight =
    rawTargetWeight != null
      ? rawTargetWeight
      : currentWeight && cutDepthKgRaw != null
        ? currentWeight - cutDepthKgRaw
        : null;
  const gapHours =
    (rhPayload?.weighInToFightGapHours as number | undefined) ??
    rawGapHours ??
    null;

  const inputStats: InputStat[] = [
    {
      label: "Cut depth",
      value:
        cutDepthKgRaw != null && cutDepthPctRaw != null
          ? `${cutDepthKgRaw.toFixed(1)} kg (${cutDepthPctRaw.toFixed(1)}%)`
          : "—",
      tone: "accent",
      iconName: "trendingDownOutline",
    },
    {
      label: "Weight",
      value:
        currentWeight && targetWeight != null
          ? `${currentWeight.toFixed(1)} → ${targetWeight.toFixed(1)} kg`
          : "—",
      iconName: "scaleOutline",
    },
    {
      label: "Weigh-in gap",
      value: gapHours != null ? `${gapHours} hours` : "—",
      iconName: "timeOutline",
    },
    {
      label: "Body",
      value: `${profile?.sex === "female" ? "Female" : "Male"} · ${profile?.age ?? "—"} yrs`,
      iconName: "personOutline",
    },
    ...(profile?.height_cm
      ? [
          {
            label: "Height",
            value: `${profile.height_cm} cm`,
            iconName: "resizeOutline" as const,
          },
        ]
      : []),
  ];

  // ── Today's hero (TodaysActionHero) ───────────────────────────────
  const days = (fpPayload?.days as any[] | undefined) ?? [];
  const todayDay = days.find((d) => d.dayIso === today) ?? null;
  const tier: "green" | "amber" | "red" =
    cutCategory === "extreme" ? "red" : cutCategory === "heavy" ? "amber" : "green";
  // The hero swaps based on three states:
  //   • isRegenerating === true → user manually tapped generate; show the
  //     wizard loading overlay (gated to manual triggers only)
  //   • !fpPayload → no plan yet → show the "Generate plan" CTA card
  //   • otherwise → show today's action hero from the existing plan
  const isGeneratingProtocol = isRegenerating;
  const needsGenerateCta = !isRegenerating && !fpPayload;
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
  // Pass server-stored value / tier / aiFeedback straight through — the
  // component owns the per-metric input UI and copy.
  const feelCheckList: FeelCheck[] = FEEL_CHECK_METRICS.map((metric) => {
    const server = feelChecks.find((c) => c.metric === metric);
    return {
      metric,
      value: server?.value,
      tier: server?.tier as FeelCheck["tier"],
      aiFeedback: server?.aiFeedback,
      loggedAt: server?.checkedAt,
    };
  });
  // Feel checks are only meaningful past the cut — show them in the
  // rehydration window (weigh-in day through fight night).
  const showFeelChecks =
    phaseTyped === "weigh-in" ||
    phaseTyped === "refeed" ||
    phaseTyped === "pre-fight";

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

      {/* 2. Today's action (or generating overlay when the plan is being
            (re)generated — replaces only the hero so the rest of the page
            stays scrollable). */}
      {isGeneratingProtocol ? (
        <ProtocolGeneratingOverlay tone={tier} />
      ) : needsGenerateCta ? (
        <button
          type="button"
          onClick={() => (isPremium ? handleRegenerate() : openPaywall())}
          className="w-full text-left card-surface rounded-2xl p-5 active:scale-[0.99] transition border border-primary/30 bg-primary/[0.04]"
        >
          {/* Header row: icon + title block + CTA label. Description is
              lifted out below the row so it spans the full card width
              instead of being squeezed into a narrow middle column. */}
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 shrink-0 rounded-2xl border flex items-center justify-center border-primary/30 bg-primary/10 text-primary">
              <Icon name={isPremium ? "sparklesOutline" : "lockClosedOutline"} size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                {isPremium ? "Ready when you are" : "Pro feature"}
              </p>
              <p className="mt-0.5 text-[17px] font-bold leading-tight text-foreground">
                {isPremium ? "Generate your fight plan" : "Unlock your fight plan"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
              {isPremium ? "Generate" : "Upgrade"}
              <Icon name="chevronForwardOutline" size={14} />
            </span>
          </div>
          {/* Description — full card width so the copy spreads
              horizontally instead of wrapping in a tall narrow column. */}
          <p className="mt-3 text-[12px] text-muted-foreground leading-snug">
            {isPremium
              ? "We'll tune the cut + rehydration timeline to your weight, training load, and prior camps. Takes 5-15 seconds."
              : "AI-tuned fight-week protocol, hour-by-hour rehydration timeline, DIY ORS recipe. All personalised to your body and prior camps."}
          </p>
        </button>
      ) : (
        <TodaysActionHero
          phase={phaseTyped}
          headline={heroHeadline}
          body={heroBody}
          metrics={heroMetrics}
          tier={tier}
          breathPulse={phaseTyped === "weigh-in"}
        />
      )}

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
      <InputsUsedChips stats={inputStats} />

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

      {/* 13. Feel checks — only during the rehydration window */}
      {showFeelChecks && (
        <FeelChecksList
          campId={campId}
          cutDepthKg={fpPayload?.cutDepthKg}
          checks={feelCheckList}
        />
      )}

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
