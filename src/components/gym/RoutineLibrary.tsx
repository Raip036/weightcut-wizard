import { useState } from "react";
import { motion } from "motion/react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { Dumbbell, ArrowUpDown, Plus, Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { RoutineDetailCard } from "./RoutineDetailCard";
import { RoutineGenProDialog } from "./RoutineGenProDialog";
import type { SavedRoutine } from "@/pages/gym/types";

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
  const [genProOpen, setGenProOpen] = useState(false);
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();

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
        <div className="h-12 w-12 rounded-xs bg-muted/50 flex items-center justify-center mx-auto mb-3">
          <Dumbbell className="h-6 w-6 text-muted-foreground/30" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No routines yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1 mb-4">Create your first routine</p>
        <div className="flex gap-2 justify-center">
          <Button onClick={onOpenManualCreator} variant="outline" className="h-10 px-3.5 rounded-xs text-xs font-medium">
            <Plus className="!size-3.5" />
            Manual
          </Button>
          {!isSubscriptionResolved || checkFeatureAccess("AI_WORKOUT_GENERATOR") ? (
            <Button onClick={onOpenGenerator} className="h-10 px-3.5 rounded-xs text-xs font-medium">
              <Sparkles className="!size-3.5" />
              AI Generate
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setGenProOpen(true)}
              className="h-10 inline-flex items-center gap-1.5 rounded-xs border border-primary/30 bg-primary/10 pl-1.5 pr-3.5 text-xs font-semibold text-foreground whitespace-nowrap active:scale-[0.97] transition-transform"
            >
              <ShimmerCrownBadge size={26} />
              AI Routines
            </button>
          )}
        </div>
        <RoutineGenProDialog open={genProOpen} onOpenChange={setGenProOpen} />
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
            className="h-9 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap"
            variant="outline"
          >
            <Plus className="!size-3.5" />
            Manual
          </Button>
          {!isSubscriptionResolved || checkFeatureAccess("AI_WORKOUT_GENERATOR") ? (
            <Button
              onClick={onOpenGenerator}
              size="sm"
              className="h-9 px-3.5 rounded-full text-xs font-semibold whitespace-nowrap"
            >
              <Sparkles className="!size-3.5" />
              AI Generate
            </Button>
          ) : (
            <button
              type="button"
              onClick={() => setGenProOpen(true)}
              className="h-9 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 pl-1 pr-3.5 text-xs font-semibold text-foreground whitespace-nowrap active:scale-[0.97] transition-transform"
            >
              <ShimmerCrownBadge size={26} />
              AI Routines
            </button>
          )}
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

      <RoutineGenProDialog open={genProOpen} onOpenChange={setGenProOpen} />
    </div>
  );
}
