import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";

const SPORTS = ["BJJ", "Boxing", "Muay Thai", "MMA", "Wrestling", "Kickboxing"] as const;
const SUGGESTED = [
  "Land my jab-cross in sparring",
  "Pass closed guard reliably",
  "Win in scrambles",
  "Develop a kick game",
];

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function NewGoalDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [sport, setSport] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const createMut = useMutation(api.training_paths.createGoalPath);

  const reset = () => {
    setStep(1);
    setSport("");
    setGoal("");
  };

  const handleCreate = async () => {
    if (!sport || !goal.trim()) return;
    setCreating(true);
    try {
      await createMut({ sport, goal: goal.trim() });
      onOpenChange(false);
      reset();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>🧙 New path</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-[13px]">Which discipline?</p>
            <div className="grid grid-cols-2 gap-2">
              {SPORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSport(s);
                    setStep(2);
                  }}
                  className="rounded-2xl border border-border/50 px-3 py-2 text-[13px] font-semibold"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[13px]">
              What outcome are you chasing in {sport}?
            </p>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Land my jab-cross in sparring"
            />
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setGoal(s)}
                  className="rounded-xl border border-border/50 px-2 py-1 text-[11px]"
                >
                  {s}
                </button>
              ))}
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[12px] text-muted-foreground"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!goal.trim()}
                onClick={() => setStep(3)}
                className="rounded-2xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              >
                Next
              </button>
            </DialogFooter>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[13px]">Create path?</p>
            <div className="rounded-xl border border-border/50 p-3 text-[12px]">
              <p>
                <span className="text-muted-foreground">Sport:</span> {sport}
              </p>
              <p>
                <span className="text-muted-foreground">Goal:</span> {goal}
              </p>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-[12px] text-muted-foreground"
              >
                Back
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleCreate}
                className="rounded-2xl bg-primary text-primary-foreground px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
