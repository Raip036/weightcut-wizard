import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CATEGORIES, MUSCLE_GROUPS, EQUIPMENT_OPTIONS } from "@/data/exerciseDatabase";
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
  }) => Promise<Exercise | null>;
}

export function CreateExerciseDialog({ open, onOpenChange, onSubmit }: CreateExerciseDialogProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ExerciseCategory>("push");
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>("chest");
  const [equipment, setEquipment] = useState<Equipment | "none">("barbell");
  const [isBodyweight, setIsBodyweight] = useState(false);

  // Resolves immediately thanks to the optimistic addCustomExercise — close instantly, no spinner.
  const handleSubmit = async () => {
    if (!name.trim()) return;
    const result = await onSubmit({
      name: name.trim(),
      category,
      muscle_group: muscleGroup,
      equipment: equipment === "none" ? null : equipment,
      is_bodyweight: isBodyweight,
    });
    if (result) {
      setName("");
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

          <div className="flex items-center justify-between py-0.5">
            <label className="text-[13px] font-medium">Bodyweight Exercise</label>
            <Switch checked={isBodyweight} onCheckedChange={setIsBodyweight} />
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
