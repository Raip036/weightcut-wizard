import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, MUSCLE_GROUPS, EQUIPMENT_OPTIONS } from "@/data/exerciseDatabase";
import { TRACKING_TYPES, type TrackingType } from "@/lib/exerciseTypes";
import { cn } from "@/lib/utils";
import type { ExerciseCategory, MuscleGroup, Equipment, Exercise } from "@/pages/gym/types";

interface CreateExerciseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    category: ExerciseCategory;
    muscle_group: string;
    equipment: Equipment | null;
    is_bodyweight: boolean;
    tracking_type: TrackingType;
  }) => Promise<Exercise | null>;
}

export function CreateExerciseDialog({ open, onOpenChange, onSubmit }: CreateExerciseDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ExerciseCategory>("push");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>("chest");
  const [equipment, setEquipment] = useState<Equipment | "none">("barbell");
  const [trackingType, setTrackingType] = useState<TrackingType>("standard");

  // Resolves immediately thanks to the optimistic addCustomExercise — close instantly, no spinner.
  const handleSubmit = async () => {
    if (!name.trim()) return;
    const result = await onSubmit({
      name: name.trim(),
      category,
      muscle_group: muscleGroup,
      equipment: equipment === "none" ? null : equipment,
      // "bodyweight" tracking maps onto the legacy is_bodyweight flag so the
      // set row keeps its reps-only behavior.
      is_bodyweight: trackingType === "bodyweight",
      tracking_type: trackingType,
    });
    if (result) {
      setName("");
      setTrackingType("standard");
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-xl border-0 bg-card/95 backdrop-blur-xl p-0 pb-[calc(env(safe-area-inset-bottom,0px)+3.5rem)]">
        <div className="px-4 pt-4 pb-3">
          <SheetHeader>
            <SheetTitle className="text-[15px] font-semibold text-center">Create Exercise</SheetTitle>
          </SheetHeader>
        </div>

        <div className="px-4 space-y-2.5">
          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-0.5 block">Exercise Name</label>
            <Input
              placeholder="e.g. Zercher Squat"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-0.5 block">Category</label>
              <Select value={category} onValueChange={(v) => setCategory(v as ExerciseCategory)}>
                <SelectTrigger className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-[13px] font-medium text-muted-foreground mb-0.5 block">Muscle Group</label>
              <Select value={muscleGroup} onValueChange={(v) => setMuscleGroup(v as MuscleGroup)}>
                <SelectTrigger className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MUSCLE_GROUPS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-0.5 block">Equipment</label>
            <Select value={equipment} onValueChange={(v) => setEquipment(v as Equipment)}>
              <SelectTrigger className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EQUIPMENT_OPTIONS.map(e => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-[13px] font-medium text-muted-foreground mb-1 block">Tracking</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TRACKING_TYPES.map((t) => {
                const active = trackingType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTrackingType(t.value)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xs border px-2 py-2 text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/12 text-primary"
                        : "border-border/30 bg-muted/20 text-muted-foreground active:bg-muted/40",
                    )}
                  >
                    <span className="block text-[12px] font-semibold leading-tight">{t.label}</span>
                    <span className="block text-[10px] leading-tight opacity-70 mt-0.5">{t.hint}</span>
                  </button>
                );
              })}
            </div>
            {trackingType === "weighted" && (
              <p className="text-[10.5px] text-muted-foreground/70 mt-1.5 leading-snug">
                Log the total weight (your bodyweight + added load). Volume counts the added load only.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 mt-3">
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors disabled:opacity-40"
          >
            Create Exercise
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
