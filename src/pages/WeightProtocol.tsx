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
import { useNavigate } from "react-router-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";
import { toast } from "sonner";
import { ProUpsellScreen } from "@/components/subscription/ProUpsellScreen";

import { ProtocolCountdownAnchor } from "@/components/protocol/ProtocolCountdownAnchor";
import { ProtocolJourneySpine } from "@/components/protocol/ProtocolJourneySpine";
import { ProtocolPlanIntro } from "@/components/protocol/ProtocolPlanIntro";
import { ProtocolWalkoutTakeover } from "@/components/protocol/ProtocolWalkoutTakeover";
import { WeightProtocolProDialog } from "@/components/protocol/WeightProtocolProDialog";
import { type CutApproach } from "@/components/protocol/CutApproachSelector";
import { ProtocolCutChapter } from "@/components/protocol/ProtocolCutChapter";
import {
  ProtocolScaleCard,
  type ProtocolScaleSubmit,
} from "@/components/protocol/ProtocolScaleCard";
import { SafetyWarningBanner, friendlyWarningTitle } from "@/components/protocol/SafetyWarningBanner";
import {
  MedicalDisclaimerAck,
  MedicalDisclaimerBanner,
} from "@/components/protocol/MedicalDisclaimerBanner";
import { OrsRecipeCard } from "@/components/protocol/OrsRecipeCard";
import { RehydrationTimeline } from "@/components/protocol/RehydrationTimeline";
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

// Regeneration is unlimited — there is no daily cap (server-side or
// client-side). The user can regenerate as many times as they want.
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
  const { isPremium: subIsPremium, openPaywall, isSubscriptionResolved } = useSubscription();
  const navigate = useNavigate();
  // DEV-ONLY: drop the Pro gate on the dev server so the full protocol +
  // rehydration output is visible while iterating on the UI. `import.meta.env.DEV`
  // is false in production builds, so the paywall stays intact in prod.
  const isPremium = subIsPremium || import.meta.env.DEV;

  // Single upgrade surface for the whole page — the shared Pro dialog used by
  // the Pro upgrade flow.
  const [proDialogOpen, setProDialogOpen] = useState(false);

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
  const clearProtocol = useMutation(api.weightProtocols.clearProtocol);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Rehydration is now a separate, manual step driven by the athlete's
  // entered sweat-loss figure — its own loading / error / editing state.
  const [isGeneratingRehydration, setIsGeneratingRehydration] = useState(false);
  const [rehydrationError, setRehydrationError] = useState<string | null>(null);
  const [editingSweat, setEditingSweat] = useState(false);
  // Walkout success is triggered intentionally by the bottom "I've made weight"
  // button, not a phase flip.
  const [finishPressed, setFinishPressed] = useState(false);

  // Regenerate now builds ONLY the carb-cut fight plan. Rehydration is
  // generated separately via the sweat-loss entry card so the athlete can
  // scale it to what they actually sweated off at the scale.
  const handleRegenerate = useCallback(async () => {
    if (!protocol?.campId) return;
    setIsRegenerating(true);
    setGenError(null);
    try {
      await generateFightPlan({ campId: protocol.campId, approach });
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Generation failed. Please try again.";
      setGenError(msg);
    } finally {
      setIsRegenerating(false);
    }
  }, [protocol?.campId, approach, generateFightPlan]);

  // Manual, sweat-driven rehydration generation. Called by ProtocolScaleCard
  // with the kg sweated off, the (editable) hours until the fight, and the
  // optional overnight sleep window — all threaded to the generator so it can
  // build the hour-by-hour plan with no intake scheduled during sleep.
  const handleGenerateRehydration = useCallback(
    async ({
      sweatKg,
      hoursUntilFight,
      sleepStartHour,
      sleepEndHour,
    }: ProtocolScaleSubmit) => {
      if (!protocol?.campId) return;
      setIsGeneratingRehydration(true);
      setRehydrationError(null);
      try {
        await generateRehydration({
          campId: protocol.campId,
          sweatLossKg: sweatKg,
          hoursUntilFight,
          ...(sleepStartHour != null ? { sleepStartHour } : {}),
          ...(sleepEndHour != null ? { sleepEndHour } : {}),
        });
        setEditingSweat(false);
      } catch (e: unknown) {
        const msg =
          e instanceof Error
            ? e.message
            : "Rehydration generation failed. Please try again.";
        setRehydrationError(msg);
      } finally {
        setIsGeneratingRehydration(false);
      }
    },
    [protocol?.campId, generateRehydration],
  );

  // Approach taps update local state only — the user must hit Regenerate
  // to commit. Avoids burning a daily generation on every accidental tap.
  const handleApproachChange = useCallback((next: CutApproach) => {
    setApproach(next);
  }, []);

  // Walkout "Start over": wipe the fight plan + rehydration server-side so
  // `getCurrentForUser` returns `fightPlan: null` and the page falls back to
  // Chapter 1 (ProtocolPlanIntro), where the athlete can generate a fresh
  // protocol. The page's only Chapter-1 gate is `!fpPayload`, which is derived
  // directly from the query — there is no local/cached copy of the plan to
  // reset — so clearing the server rows is what actually returns to Chapter 1.
  const handleProtocolReset = useCallback(async () => {
    try {
      // Server delete of the fight plan + rehydration + feel checks. The page's
      // only Chapter-1 gate is `!fpPayload` from the reactive query, so once
      // these rows are gone the query re-fires and the page falls back to
      // Chapter 1 on its own.
      await clearProtocol({});
    } catch (e) {
      // NEVER swallow silently — an invisible failure here (console-only on a
      // native build) is exactly what hid this bug across multiple attempts.
      // Surface it AND keep the finale open so the user can retry, rather than
      // closing onto a stale plan with no feedback.
      console.error("[WeightProtocol] clearProtocol failed", e);
      toast.error("Couldn't reset your protocol. Please try again.");
      return;
    }
    // Success → fully reset every piece of local state so nothing survives to
    // re-hydrate the old plan, then land the user at the top of Chapter 1.
    setApproach("standard");
    setGenError(null);
    setRehydrationError(null);
    setIsRegenerating(false);
    setIsGeneratingRehydration(false);
    setEditingSweat(false);
    setFinishPressed(false);
    window.scrollTo({ top: 0 });
  }, [clearProtocol]);

  // ── Top-level states ──────────────────────────────────────────────
  // Decide free-vs-Pro FIRST so a free user always gets the animated wizard
  // Pro wall the moment they open the page — even before (or without) an
  // active camp. Wait for subscription state to resolve so a paying user
  // never flashes the wall while it loads. `isPremium` is forced true on the
  // dev server (see above), so this only gates real production free users.
  if (!isSubscriptionResolved && !import.meta.env.DEV) {
    return <ProtocolPageSkeleton />;
  }
  if (!isPremium) {
    return (
      <ProUpsellScreen
        title="Your Weight Protocol is a Pro feature"
        blurb="A day-by-day cut and a rehydration plan, tuned to your body, training load, and weigh-in window."
        perks={[
          "Day-by-day carb, water and sodium taper",
          "Rehydration timeline and ORS recipe after weigh-in",
          "Tuned to your camp history and weigh-in gap",
          "Auto-adjusts as you log your weight",
        ]}
        upgradeLabel="Upgrade to Pro"
        onUpgrade={() => {
          triggerHapticSelection();
          openPaywall();
        }}
        onDismiss={() => navigate(-1)}
      />
    );
  }

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
  const currentWeight = rawCurrentWeight ?? 0;
  const targetWeight =
    rawTargetWeight != null
      ? rawTargetWeight
      : currentWeight && cutDepthKgRaw != null
        ? currentWeight - cutDepthKgRaw
        : null;
  const gapHours =
    (rhPayload?.gapHours as number | undefined) ??
    (rhPayload?.derivedSnapshot?.gapHours as number | undefined) ??
    (rhPayload?.weighInToFightGapHours as number | undefined) ??
    rawGapHours ??
    null;

  // ── Cut taper days ────────────────────────────────────────────────
  const days = (fpPayload?.days as any[] | undefined) ?? [];
  const tier: "green" | "amber" | "red" =
    cutCategory === "extreme" ? "red" : cutCategory === "heavy" ? "amber" : "green";
  // Show the wizard loading overlay only when the user manually tapped
  // generate (gated to manual triggers).
  const isGeneratingProtocol = isRegenerating;

  // ── Safety warnings — only the highest severity wins, top of stack ─
  const warnings =
    (fpPayload?.safetyWarnings as
      | { severity: "info" | "warn" | "critical"; code: string; message: string }[]
      | undefined) ?? [];
  const critical = warnings.find((w) => w.severity === "critical");

  // ── Weigh-in day (drives the countdown anchor's date label) ────────
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

  // Weigh-in timing comes from the user's PROFILE (set in onboarding),
  // surfaced by getCurrentForUser. Same-day weigh-in → the cut holds carbs.
  const weighInSameDay =
    (protocol as { weighInSameDay?: boolean }).weighInSameDay ?? false;
  const fiberStrategy = fpPayload?.fiberStrategy as string | undefined;

  // Litres of ORS to replace — the hero figure shown above the recipe.
  const rehydLitres =
    (rhPayload?.derivedSnapshot?.totalLitresTarget as number | undefined) ??
    (rhPayload?.orsRecipe?.totalLitresTarget as number | undefined) ??
    null;

  // Finale is driven by the user pressing "I've made weight & refuelled" at the
  // bottom of the rehydration plan — an intentional success moment, not a phase
  // flip. Suppresses the countdown while showing.
  const showFinale = finishPressed;

  // Pre-formatted weigh-in date for the countdown anchor, from the D-0
  // skeleton day's ISO when present.
  const weighInDateLabel = (() => {
    const iso = weighInDay?.dayIso as string | undefined;
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  })();

  // Journey spine progression: Plan → (generate) Cut → (submit sweat) Scale ✓ +
  // Rehydrate active → (plan generated) Rehydrate ✓ + Walkout active →
  // (Finish pressed) all done.
  const rehydrated = !!rhPayload && !editingSweat;
  const journeyActive = finishPressed
    ? 5
    : rehydrated
      ? 4
      : isGeneratingRehydration
        ? 3
        : fpPayload
          ? 1
          : 0;

  return (
    <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
      {/* 0. Journey spine — the story map (Plan → Cut → Scale → Rehydrate →
            Walkout). Shows the athlete where they are in the arc. */}
      <ProtocolJourneySpine active={journeyActive} />

      {/* Medical disclaimer (App Store Guideline 1.4.1) — persistent, shown for
          EVERY plan. First view gets a one-time "I understand" acknowledgement;
          afterwards it stays as a passive amber notice. Sits above the cut /
          rehydration protocol so the disclaimer is visible at the point of use,
          not buried in Settings. */}
      <MedicalDisclaimerAck />

      {!fpPayload ? (
        /* ── Chapter 01 · The Plan — clean intro shown before generation.
              The athlete's weight, target and profile are already known, so
              this is just the read + the one Generate action (no crowded
              taper / inputs / approach until a plan exists). */
        isGeneratingProtocol ? (
          <ProtocolGeneratingOverlay tone={tier} />
        ) : (
          <ProtocolPlanIntro
            startKg={currentWeight}
            targetKg={targetWeight}
            daysToWeighIn={daysToWeighIn}
            approach={approach}
            onApproachChange={handleApproachChange}
            onGenerate={handleRegenerate}
          />
        )
      ) : (
      <>
      {/* 0b. Weigh-in countdown anchor — the pivot the whole flow hinges on.
            Suppressed once the finale is showing. */}
      {!showFinale && (
        <ProtocolCountdownAnchor
          daysToWeighIn={daysToWeighIn}
          dateLabel={weighInDateLabel}
        />
      )}

      {/* Safety — keep the extreme-cut warning regardless of layout. */}
      {critical && (
        <SafetyWarningBanner
          level="red"
          title={friendlyWarningTitle(critical.code)}
          body={critical.message}
        />
      )}

      {/* The Cut — mockup-exact taper card (countdown sits above it). While a
          regeneration is running, show the loader in its place. */}
      {isGeneratingProtocol ? (
        <ProtocolGeneratingOverlay tone={tier} />
      ) : (
        <ProtocolCutChapter
          targetKg={targetWeight}
          sameDay={weighInSameDay}
          fiberStrategy={fiberStrategy}
          days={days.map((d: any) => ({
            daysToWeighIn: d.daysToWeighIn,
            carbsGrams: d.carbsGrams,
            waterLitres: d.waterLitres,
            sodiumMg: d.sodiumMg,
            fiberGrams: d.fiberGrams,
            isToday: d.dayIso === today,
          }))}
        />
      )}

      {/* Compact stop-immediately notice next to the dehydration / heat phase
          of the cut. Mirrors the abort triggers (HR spikes, cramping,
          dizziness, confusion) surfaced by the fight-week analysis. */}
      {!isGeneratingProtocol && (
        <MedicalDisclaimerBanner variant="compact" />
      )}

      {/* The Scale → Rehydrate. Enter kilos sweated off; on submit the
          rehydration plan generates and its full detail replaces the input. */}
      {!rhPayload || editingSweat ? (
        <ProtocolScaleCard
          onGenerate={handleGenerateRehydration}
          isLoading={isGeneratingRehydration}
          error={rehydrationError}
          defaultValue={rhPayload?.derivedSnapshot?.sweatLossKg}
          defaultHoursUntilFight={
            (rhPayload?.gapHours as number | undefined) ?? rawGapHours ?? undefined
          }
        />
      ) : (
        <>
          <ProtocolSectionDivider label="After the scale · Rehydration" />
          {/* Litres-to-replace HERO — the headline figure, above the recipe. */}
          {rehydLitres != null && (
            <div
              className="rounded-2xl border text-center p-5"
              style={{ borderColor: "hsl(190 90% 55% / 0.3)", background: "hsl(190 90% 55% / 0.06)" }}
            >
              <p
                className="display-number font-extrabold tabular-nums leading-none"
                style={{ fontSize: 56, color: "hsl(190 90% 55%)" }}
              >
                {rehydLitres.toFixed(1)} L
              </p>
              <p className="text-[12px] text-muted-foreground mt-1.5">
                to replace · over the first 6 hours
              </p>
            </div>
          )}
          <OrsRecipeCard
            perLitre={rhPayload.orsRecipe?.perLitre ?? []}
            totalLitresTarget={rhPayload.orsRecipe?.totalLitresTarget ?? 0}
            diyShoppingList={rhPayload.orsRecipe?.diyShoppingList ?? []}
            commercialEquivalents={rhPayload.orsRecipe?.commercialEquivalents ?? []}
          />
          <RehydrationTimeline
            anchors={hours}
            gapHours={gapHours ?? 24}
            totalLitresTarget={
              rhPayload.derivedSnapshot?.totalLitresTarget ??
              rhPayload.orsRecipe?.totalLitresTarget
            }
            deficitTooLarge={Boolean(rhPayload.deficitTooLarge)}
          />
          <DoNotCallouts items={(rhPayload?.doNots as string[] | undefined) ?? []} />
          {showFeelChecks && (
            <FeelChecksList
              campId={campId}
              cutDepthKg={fpPayload?.cutDepthKg}
              checks={feelCheckList}
            />
          )}
          {!finishPressed && (
            <button
              type="button"
              onClick={() => setFinishPressed(true)}
              className="w-full flex items-center justify-center rounded-2xl px-4 py-3.5 text-[14px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
              style={{ background: "hsl(152 64% 47%)" }}
            >
              I've made weight &amp; refuelled
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditingSweat(true)}
            className="block w-full text-center text-[12px] text-muted-foreground/80 underline-offset-4 hover:text-foreground hover:underline transition-colors"
          >
            Re-enter sweat-loss &amp; regenerate
          </button>
        </>
      )}

      {/* Regenerate button + error — unlimited, no daily cap */}
      <ProtocolRegenerateButton
        onRegenerate={handleRegenerate}
        isLoading={isRegenerating}
      />
      {genError && (
        <ProtocolGenerationError error={genError} onRetry={handleRegenerate} />
      )}

      {/* Floating back-to-top */}
      <BackToTopFAB />
      </>
      )}

      {/* Walkout finale — full-page takeover after "I've made weight &
          refuelled": celebration → shareable recap poster → Start over (which
          clears the plan and drops back to Chapter 1). */}
      {finishPressed && (
        <ProtocolWalkoutTakeover
          stats={{
            madeWeightKg: targetWeight,
            rehydratedLitres: rehydLitres,
            walkedInKg: currentWeight,
          }}
          onReset={handleProtocolReset}
        />
      )}

      {/* Single shared upgrade explainer — opened by the top gate and every
          locked preview below. Shows the value story before the paywall. */}
      <WeightProtocolProDialog
        open={proDialogOpen}
        onOpenChange={setProDialogOpen}
      />
    </div>
  );
}
