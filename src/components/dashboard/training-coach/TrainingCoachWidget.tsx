/**
 * Training Coach widget, replaces the stub TrainingInsightsWidget on the
 * user dashboard. Pro-only. Surfaces:
 *  - Path proposal banners (note-driven, top of widget)
 *  - Hero step card with wizard line + next-2 preview
 *  - 1-tap feedback strip when a step just auto-completed
 *  - Active paths progress carousel
 *  - Goal-driven creation via the "+" button
 *
 * Sub-sheets (StepDetailSheet, RoadmapSheet, NewGoalDialog) handle drill-in
 * navigation. All Convex reads are reactive subscriptions; the widget
 * silently refreshes when the planner creates/advances paths in the
 * background.
 */
import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { FEATURE_FLAGS } from "@/lib/featureFlags";
import { LockedState } from "./LockedState";
import { EmptyState } from "./EmptyState";
import { HeroStepCard } from "./HeroStepCard";
import { PathsCarousel, type PathChip } from "./PathsCarousel";
import { PathProposalBanner } from "./PathProposalBanner";
import { FeedbackStrip } from "./FeedbackStrip";
import { StepDetailSheet } from "./StepDetailSheet";
import { RoadmapSheet } from "./RoadmapSheet";
import { NewGoalDialog } from "./NewGoalDialog";

export function TrainingCoachWidget() {
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const [roadmapPathId, setRoadmapPathId] = useState<Id<"training_paths"> | null>(null);
  const [feedbackDismissed, setFeedbackDismissed] = useState<Set<string>>(new Set());

  // Gate every Convex subscription on the feature flag with `"skip"` so the
  // widget is fully inert when the flag is off, no server calls, no errors
  // if the deployment hasn't deployed the training_paths functions yet.
  // (React hooks still run in the same order; `useQuery` accepts `"skip"`.)
  const enabled = FEATURE_FLAGS.enableTrainingCoachPaths;
  const usage = useQuery(api.training_paths.pathSlotUsage, enabled ? {} : "skip");
  const hero = useQuery(api.training_paths.getHeroStep, enabled ? {} : "skip");
  const activePaths = useQuery(api.training_paths.getActivePaths, enabled ? {} : "skip");
  const queuedPaths = useQuery(api.training_paths.getQueuedPaths, enabled ? {} : "skip");
  const proposals = useQuery(api.training_paths.getActivePathProposals, enabled ? {} : "skip");
  const pendingFeedback = useQuery(api.training_paths.getPendingFeedbackStep, enabled ? {} : "skip");

  const acceptMut = useMutation(api.training_paths.acceptPathProposal);
  const snoozeMut = useMutation(api.training_paths.snoozePathProposal);
  const refreshAction = useAction(api.actions.trainingCoachPlanner.run);

  if (!enabled) return null;

  // Loading shimmer while any of the queries hasn't resolved yet.
  if (
    usage === undefined ||
    hero === undefined ||
    activePaths === undefined ||
    proposals === undefined
  ) {
    return <div className="rounded-2xl card-surface h-32 animate-pulse" />;
  }
  if (!usage.isPro) return <LockedState />;

  // Empty state, no hero, no active paths, no pending proposals.
  if (!hero && (activePaths?.length ?? 0) === 0 && (proposals?.length ?? 0) === 0) {
    return (
      <>
        <EmptyState onSetGoal={() => setGoalDialogOpen(true)} />
        <NewGoalDialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen} />
      </>
    );
  }

  // Build path chips for the carousel from active paths + their step counts.
  // We don't query steps for every path here, the totalSteps/completedSteps
  // for non-hero paths are exposed via a future enrich query; for v1 we show
  // the hero's count when available and a placeholder dot count otherwise.
  const heroPathId = hero?.path._id ?? null;
  const pathChips: PathChip[] = (activePaths ?? []).map((p) => ({
    _id: p._id,
    goal: p.goal,
    totalSteps: heroPathId === p._id ? hero.totalSteps : 5,
    completedSteps:
      heroPathId === p._id ? Math.max(0, hero.stepNumber - 1) : 0,
  }));

  const openRoadmap = (pathId: Id<"training_paths">) => {
    setRoadmapPathId(pathId);
    setRoadmapOpen(true);
  };

  return (
    <div className="rounded-2xl card-surface border border-border/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-bold">
          Training Coach
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Refresh paths"
            onClick={() => void refreshAction({ trigger: "manualRefresh" })}
            className="h-7 w-7 rounded-full flex items-center justify-center active:bg-muted/40"
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button
            type="button"
            aria-label="New goal path"
            onClick={() => setGoalDialogOpen(true)}
            className="h-7 w-7 rounded-full flex items-center justify-center active:bg-muted/40"
          >
            <Plus className="h-4 w-4 text-primary" />
          </button>
        </div>
      </div>

      {/* Path proposal banners (top of widget, max 3 from server-side cap). */}
      {(proposals ?? []).map((p) => (
        <PathProposalBanner
          key={p._id}
          proposal={p}
          onAccept={(id) => void acceptMut({ proposalId: id })}
          onSnooze={(id) => void snoozeMut({ proposalId: id })}
        />
      ))}

      {/* Hero step card. */}
      {hero && (
        <HeroStepCard
          hero={hero}
          onTap={() => setDetailOpen(true)}
        />
      )}

      {/* 1-tap feedback strip. Dismissed locally to avoid re-rendering after
          the mutation lands but before the server flips the step. */}
      {pendingFeedback && !feedbackDismissed.has(pendingFeedback._id) && (
        <FeedbackStrip
          stepId={pendingFeedback._id}
          onDone={() =>
            setFeedbackDismissed((prev) =>
              new Set([...Array.from(prev), pendingFeedback._id]),
            )
          }
        />
      )}

      {/* Paths carousel. */}
      <PathsCarousel
        paths={pathChips}
        queuedPaths={queuedPaths ?? []}
        onTapPath={openRoadmap}
      />

      {/* Sheets / dialogs. */}
      <StepDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        step={hero?.currentStep ?? null}
        pathId={hero?.path._id ?? null}
      />
      <RoadmapSheet
        open={roadmapOpen}
        onOpenChange={setRoadmapOpen}
        pathId={roadmapPathId}
      />
      <NewGoalDialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen} />
    </div>
  );
}
