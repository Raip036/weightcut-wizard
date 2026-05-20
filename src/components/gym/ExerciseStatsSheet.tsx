import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Trophy } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { ExercisePerformanceChart } from "./ExercisePerformanceChart";
import { formatWeight, formatVolume } from "@/lib/gymCalculations";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { ExerciseProgressCard } from "@/components/share/cards/ExerciseProgressCard";
import type { Exercise, ExercisePR, GymSet } from "@/pages/gym/types";

interface ExerciseStatsSheetProps {
  exercise: Exercise | null;
  pr: ExercisePR | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExerciseStatsSheet({ exercise, pr, open, onOpenChange }: ExerciseStatsSheetProps) {
  // Share-card variant — `dark` (default solid background) or `transparent`
  // (over-photo, no background fill). Mirrors the swipe-to-toggle pattern in
  // GymTracker's session share dialog and the dashboard's fight-form sheet.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareVariant, setShareVariant] = useState<"dark" | "transparent">("dark");
  // Reactive Convex query — chart and PRs auto-refresh as the user logs more
  // sets in any active session, including this one. No manual cache layer.
  const rows = useQuery(
    api.gym_sessions.listSetsForExercise,
    open && exercise ? { exerciseId: exercise.id as unknown as Id<"exercises">, limit: 100 } : "skip",
  );
  const sets = (rows ?? []) as unknown as GymSet[];
  const loading = open && exercise !== null && rows === undefined;

  if (!exercise) return null;

  // Has anything worth sharing? We require at least one working set so the
  // card doesn't render an empty PR strip and a "log more sessions" chart —
  // that'd be the wrong screenshot to post.
  const hasShareableData = sets.some((set) => !set.is_warmup);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
        {/* Header is centred: share lives in the top-left (absolute), the
            sheet's built-in close X stays in the top-right, and the title +
            muscle-group subline sit dead-centre between them. Mirrors the
            FightFormScoreSheet pattern so both share entry points feel the
            same. */}
        <SheetHeader className="relative flex flex-col items-center justify-center min-h-9 space-y-0 pb-1 px-9">
          <SheetTitle className="text-lg font-bold tracking-tight text-center">{exercise.name}</SheetTitle>
          <p className="text-xs text-muted-foreground capitalize text-center">
            {exercise.muscle_group.replace("_", " ")} · {exercise.equipment || "bodyweight"}
          </p>
          {hasShareableData && (
            <div className="absolute left-0 top-0">
              <ShareButton onClick={() => { setShareVariant("dark"); setShareOpen(true); }} />
            </div>
          )}
        </SheetHeader>

        <motion.div
          variants={staggerContainer(60)}
          initial="hidden"
          animate="visible"
          className="space-y-5 mt-4"
        >
          {/* Hero PR — single big card with the headline lift */}
          {sets.length > 0 && (() => {
            const workingSets = sets.filter((s) => !s.is_warmup);
            const maxWeight = Math.max(0, ...workingSets.map((s) => s.weight_kg ?? 0));
            const maxReps = Math.max(0, ...workingSets.map((s) => s.reps));
            const maxVolume = Math.max(0, ...workingSets.map((s) => (s.weight_kg ?? 0) * s.reps));
            const bestSet = workingSets.reduce<typeof workingSets[number] | null>((best, s) => {
              const w = s.weight_kg ?? 0;
              if (!best || w > (best.weight_kg ?? 0)) return s;
              if (w === (best.weight_kg ?? 0) && s.reps > best.reps) return s;
              return best;
            }, null);

            return (
              <>
                {/* Hero PR card */}
                <motion.div
                  variants={staggerItem}
                  className="relative rounded-3xl border border-primary/25 bg-primary/[0.06] p-5 text-center overflow-hidden"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">
                    Heaviest set
                  </p>
                  {maxWeight > 0 ? (
                    <>
                      <p className="mt-2 display-number text-[44px] font-black tabular-nums leading-none text-primary">
                        {formatWeight(maxWeight)}
                        <span className="text-[18px] font-bold text-primary/80 ml-1">kg</span>
                      </p>
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-foreground">
                        × {bestSet?.reps ?? maxReps} reps
                        <Trophy className="h-3.5 w-3.5 text-yellow-400" />
                      </p>
                    </>
                  ) : maxReps > 0 ? (
                    <>
                      <p className="mt-2 display-number text-[44px] font-black tabular-nums leading-none text-primary">
                        {maxReps}
                      </p>
                      <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-foreground">
                        max reps
                        <Trophy className="h-3.5 w-3.5 text-yellow-400" />
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[13px] text-muted-foreground">No working sets yet</p>
                  )}
                </motion.div>

                {/* Strength Progression Chart */}
                <motion.div variants={staggerItem} className="rounded-2xl card-surface border border-border/50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2 px-1">
                    Trend over time
                  </p>
                  <ExercisePerformanceChart sets={sets} loading={loading} />
                </motion.div>

                {/* Mini stat tiles */}
                <motion.div variants={staggerItem} className="grid grid-cols-3 gap-2">
                  <div className="rounded-2xl card-surface border border-border/50 px-2 py-3 text-center">
                    <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                      {maxReps}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">max reps</p>
                  </div>
                  <div className="rounded-2xl card-surface border border-border/50 px-2 py-3 text-center">
                    <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                      {maxVolume > 0 ? formatVolume(maxVolume) : "—"}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">best vol kg</p>
                  </div>
                  <div className="rounded-2xl card-surface border border-border/50 px-2 py-3 text-center">
                    <p className="display-number text-[18px] font-black tabular-nums leading-none text-foreground">
                      {workingSets.length}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">sets</p>
                  </div>
                </motion.div>
              </>
            );
          })()}

          {/* Recent sets — slightly compact list */}
          {sets.length > 0 && (
            <motion.div variants={staggerItem} className="space-y-2">
              <p className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                Recent sets · {Math.min(10, sets.length)} of {sets.length}
              </p>
              <div className="card-surface rounded-2xl border border-border/50 overflow-hidden divide-y divide-border/20">
                {sets.slice(0, 10).map((set) => (
                  <div key={set.id} className="flex items-center gap-3 text-xs px-3 py-2.5">
                    <span className="text-muted-foreground w-16 shrink-0">
                      {new Date(set.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className="display-number text-[13px] font-bold text-foreground">
                      {set.is_bodyweight ? "BW" : `${formatWeight(set.weight_kg)} kg`}
                    </span>
                    <span className="text-muted-foreground/60">×</span>
                    <span className="display-number text-[13px] font-bold text-foreground">{set.reps}</span>
                    {set.is_warmup && (
                      <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">warmup</span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </motion.div>
      </SheetContent>

      {/* Shareable Instagram-story card. Lives outside the bottom sheet so the
          dialog overlay sits cleanly above it. Swipe horizontally on the
          preview to toggle the transparent / dark variant — matches the
          existing share dialogs in GymTracker and FightFormScoreSheet. */}
      <ShareCardDialog
        open={shareOpen}
        onOpenChange={(v) => { setShareOpen(v); if (v) setShareVariant("dark"); }}
        transparent={shareVariant === "transparent"}
        showSwipeHint
        title="Share Progress"
        shareTitle={`${exercise.name} progress`}
        shareText={`My ${exercise.name} progress on FightCamp Wizard`}
      >
        {({ cardRef, aspect, transparent }) => {
          let touchStartX = 0;
          const flashCardWrapper = (el: HTMLElement | null) => {
            if (!el) return;
            el.classList.remove("share-variant-flash");
            void el.offsetWidth;
            el.classList.add("share-variant-flash");
          };
          return (
            <div
              onTouchStart={(e) => { touchStartX = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const delta = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(delta) > 40) {
                  setShareVariant((v) => (v === "dark" ? "transparent" : "dark"));
                  flashCardWrapper(e.currentTarget as HTMLElement);
                }
              }}
            >
              <ExerciseProgressCard
                ref={cardRef}
                exerciseName={exercise.name}
                muscleGroup={exercise.muscle_group}
                sets={sets}
                aspect={aspect}
                transparent={transparent}
              />
            </div>
          );
        }}
      </ShareCardDialog>
    </Sheet>
  );
}
