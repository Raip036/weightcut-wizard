/**
 * Coach push UI on /coach/athletes/:id. Pro coaches can prescribe a multi-
 * step training path to an athlete; the path appears on the athlete's
 * Training Coach widget with a coach-source ribbon. Paths prescribed here
 * do NOT count against the athlete's 3-active soft cap (coach intent wins).
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";

const SPORTS = ["BJJ", "Boxing", "Muay Thai", "MMA", "Wrestling", "Kickboxing"] as const;

type Props = { athleteId: Id<"users"> };

export function PrescribePathSection({ athleteId }: Props) {
  const [sport, setSport] = useState<string>("BJJ");
  const [goal, setGoal] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const prescribe = useMutation(api.training_paths.prescribePath);

  const handleSend = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    try {
      await prescribe({ athleteId, sport, goal: goal.trim() });
      toast({
        title: "Path sent",
        description: `${sport}: ${goal.trim()}`,
      });
      setGoal("");
    } catch (err) {
      toast({
        title: "Couldn't send path",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border/50 card-surface p-4">
      <h3 className="text-[14px] font-semibold mb-3">Prescribe a path</h3>
      <div className="space-y-2">
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-[13px]"
          aria-label="Sport"
        >
          {SPORTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. Master kimura from side control"
          aria-label="Goal"
        />
        <button
          type="button"
          disabled={busy || !goal.trim()}
          onClick={handleSend}
          className="w-full rounded-2xl bg-primary text-primary-foreground px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send to athlete"}
        </button>
      </div>
    </section>
  );
}
