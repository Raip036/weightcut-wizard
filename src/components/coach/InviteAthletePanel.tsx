import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

interface Props {
  gymId: string;
}

/**
 * Coach-side panel for inviting athletes (or assistant coaches) to a gym
 * by pasting their Convex user id. Calls `gym_members.addMember` which —
 * after the security fix — now creates a *pending* `gym_invites` row that
 * the target user must explicitly accept on their dashboard. The target
 * cannot be silently added; sharing data is opt-in once they accept.
 *
 * TODO: replace the raw user-id input with an "invite by email / handle"
 * flow once the backend exposes a lookup that resolves a public handle
 * → users._id. For v1 we surface the primitive form so coaches can
 * onboard known athletes immediately.
 */
export function InviteAthletePanel({ gymId }: Props) {
  const { toast } = useToast();
  const addMember = useMutation(api.gym_members.addMember);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"athlete" | "coach">("athlete");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = userId.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    triggerHaptic(ImpactStyle.Light);
    setSubmitting(true);
    try {
      const result = await addMember({
        gymId: gymId as Id<"gyms">,
        userId: userId.trim() as Id<"users">,
        memberRole: role,
      });
      if (result === null) {
        toast({
          title: "Already a member",
          description: "This user is already active in this gym.",
        });
      } else {
        toast({
          title: "Invite sent",
          description: "They'll see it on their dashboard.",
        });
      }
      setUserId("");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Could not send invite";
      toast({
        title: "Invite failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-surface rounded-xs border border-border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-xs bg-primary/10 flex items-center justify-center flex-shrink-0">
          <UserPlus className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight">Invite athletes</p>
          <p className="text-[11px] text-muted-foreground leading-tight">
            Send a pending invite by user id
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          type="text"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User ID"
          className="w-full h-11 px-3 rounded-xs bg-muted/40 border border-border text-[13px] tabular-nums placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="User ID"
        />

        <div className="flex items-center gap-2">
          <div className="flex-1 flex gap-1 p-1 rounded-xs bg-muted/40 border border-border">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                setRole("athlete");
              }}
              className={`flex-1 h-9 rounded-xs text-[12px] font-semibold transition-colors ${
                role === "athlete"
                  ? "bg-background text-foreground"
                  : "text-muted-foreground"
              }`}
              aria-pressed={role === "athlete"}
            >
              Athlete
            </button>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                setRole("coach");
              }}
              className={`flex-1 h-9 rounded-xs text-[12px] font-semibold transition-colors ${
                role === "coach"
                  ? "bg-background text-foreground"
                  : "text-muted-foreground"
              }`}
              aria-pressed={role === "coach"}
            >
              Coach
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full h-11 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.99] transition-transform inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:active:scale-100"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {submitting ? "Sending" : "Send invite"}
        </button>
      </form>

      <p className="text-[11px] text-muted-foreground leading-snug">
        Pending invites are visible to the athlete on their dashboard.
      </p>
    </div>
  );
}
