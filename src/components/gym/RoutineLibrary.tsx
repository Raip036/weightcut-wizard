import { useState } from "react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Dumbbell, ArrowUpDown, Plus, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { RoutineDetailCard } from "./RoutineDetailCard";
import type { SavedRoutine } from "@/pages/gym/types";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

interface RoutineLibraryProps {
  routines: SavedRoutine[];
  loading: boolean;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onStartWorkout: (routine: SavedRoutine, dayFilter?: string) => void;
  onOpenGenerator: () => void;
  onOpenManualCreator: () => void;
}

type SortMode = "recent" | "name" | "goal";

export function RoutineLibrary({ routines, loading, onDelete, onRename, onStartWorkout, onOpenGenerator, onOpenManualCreator }: RoutineLibraryProps) {
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [deleteTarget, setDeleteTarget] = useState<SavedRoutine | null>(null);
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_WORKOUT_GENERATOR");

  const sorted = [...routines].sort((a, b) => {
    switch (sortMode) {
      case "name":
        return a.name.localeCompare(b.name);
      case "goal":
        return a.goal.localeCompare(b.goal) || b.created_at.localeCompare(a.created_at);
      case "recent":
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });

  const cycleSortMode = () => {
    const modes: SortMode[] = ["recent", "name", "goal"];
    const idx = modes.indexOf(sortMode);
    setSortMode(modes[(idx + 1) % modes.length]);
  };

  const sortLabel: Record<SortMode, string> = {
    recent: "Recent",
    name: "A-Z",
    goal: "Goal",
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDelete(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="card-surface rounded-xs p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="h-5 w-28 rounded-full shimmer-skeleton" />
              <div className="h-4 w-16 rounded shimmer-skeleton" />
            </div>
            <div className="flex gap-2">
              <div className="h-4 w-16 rounded-full shimmer-skeleton" />
              <div className="h-4 w-12 rounded-full shimmer-skeleton" />
              <div className="h-4 w-20 rounded-full shimmer-skeleton" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (routines.length === 0) {
    return (
      <div className="card-surface rounded-xs p-8 text-center">
        <div className="h-12 w-12 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
          <Dumbbell className="h-6 w-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No routines yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1 mb-4">Create your first routine</p>
        <div className="flex gap-2 justify-center">
          <Button onClick={onOpenManualCreator} variant="outline" className="h-10 px-3.5 rounded-2xl text-xs font-medium">
            <Plus className="!size-3.5" />
            Manual
          </Button>
          <Button onClick={onOpenGenerator} className="relative h-10 px-3.5 rounded-2xl text-xs font-medium">
            <span className="inline-flex items-center gap-1.5">
              AI Generate
            </span>
            {!hasAiAccess && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-primary-foreground/70 pointer-events-none">
                <Crown className="!size-2.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
              </span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            onClick={onOpenManualCreator}
            size="sm"
            className="h-8 px-2.5 rounded-2xl text-xs font-medium"
            variant="outline"
          >
            <Plus className="!size-3.5" />
            Manual
          </Button>
          <Button
            onClick={onOpenGenerator}
            size="sm"
            className="relative h-8 px-2.5 rounded-2xl text-xs font-medium"
          >
            <span className="inline-flex items-center gap-1.5">
              AI Generate
            </span>
            {!hasAiAccess && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-primary-foreground/70 pointer-events-none">
                <Crown className="!size-2.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
              </span>
            )}
          </Button>
        </div>
        <button
          onClick={cycleSortMode}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/30 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortLabel[sortMode]}
        </button>
      </div>

      {/* Routine list */}
      <motion.div
        variants={staggerContainer(50)}
        initial="hidden"
        animate="visible"
        className="space-y-3"
      >
        {sorted.map(routine => (
          <motion.div key={routine.id} variants={staggerItem}>
            <RoutineDetailCard
              routine={routine}
              onDelete={(id) => setDeleteTarget(routines.find(r => r.id === id) || null)}
              onRename={onRename}
              onStartWorkout={onStartWorkout}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Delete confirmation */}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={handleConfirmDelete}
        title="Delete Routine"
        itemName={deleteTarget?.name}
      />
    </div>
  );
}
