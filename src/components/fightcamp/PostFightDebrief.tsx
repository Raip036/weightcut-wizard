import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection } from "@/lib/haptics";
import { logger } from "@/lib/logger";

/**
 * Post-fight debrief prompt (Fight Camp Coach redesign, Phase 3, spec §5/§6).
 *
 * Renders nothing unless `getPendingDebrief` reports a past camp that still
 * needs a debrief. When one exists, shows a compact prompt card ("How did
 * {camp} go?"); tapping it opens a small form (feeling / optional rebound kg /
 * optional note). Submitting calls `recordDebrief`, which populates the
 * `fight_camps` retrospective fields the coach's cross-camp memory reads back.
 *
 * Mount once anywhere global (Dashboard/Camp). A separate agent owns mounting.
 */
const FEELING_CHIPS = [
  { value: "strong",  label: "Strong",  tone: "bg-func-recovery-green/20 text-func-recovery-green" },
  { value: "ok",      label: "OK",      tone: "bg-primary/15 text-primary" },
  { value: "drained", label: "Drained", tone: "bg-func-warning-yellow/20 text-func-warning-yellow" },
] as const;

export function PostFightDebrief({
  className,
}: {
  className?: string;
}): JSX.Element | null {
  const pending = useQuery(api.fightCampDebrief.getPendingDebrief);
  const recordDebrief = useMutation(api.fightCampDebrief.recordDebrief);
  const { toast } = useToast();
  const prefersReduced = useReducedMotion();

  const [open, setOpen] = useState(false);
  // Locally dismiss for this session so "Later" hides the card until the
  // next app load (no schema write; the camp stays pending server-side).
  const [dismissed, setDismissed] = useState(false);

  const [feeling, setFeeling] = useState<string>("");
  const [reboundKg, setReboundKg] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Loading (undefined) or nothing pending (null) or dismissed → render nothing.
  if (!pending || dismissed) return null;

  const submit = async () => {
    if (!feeling) return;
    setSaving(true);
    try {
      const reboundParsed = parseFloat(reboundKg);
      await recordDebrief({
        campId: pending._id,
        performanceFeeling: feeling,
        reboundKg: Number.isFinite(reboundParsed) ? reboundParsed : undefined,
        notes: notes.trim() || undefined,
      });
      triggerHapticSelection();
      toast({
        title: "Debrief saved",
        description: "Your coach will use this to learn from this camp.",
      });
      setOpen(false);
      setDismissed(true);
    } catch (err) {
      logger.warn("Post-fight debrief save failed", { error: err });
      toast({
        title: "Couldn't save",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Prompt card */}
      <motion.div
        className={className}
        initial={prefersReduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 320 }}
      >
        <div className="rounded-2xl border border-border/50 bg-card/95 p-4 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-func-warning-yellow/15 flex items-center justify-center">
            <Icon name="flameOutline" size={20} aria-label="Fight camp" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground leading-snug truncate">
              How did {pending.name} go?
            </p>
            <p className="text-[12px] text-muted-foreground leading-snug">
              A quick debrief sharpens your next camp.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setOpen(true);
              }}
              className="h-9 min-w-[88px] rounded-xs text-[13px] font-semibold"
            >
              Debrief
            </Button>
            <button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                setDismissed(true);
              }}
              className="h-9 min-h-[44px] text-[12px] font-semibold text-muted-foreground/80 active:text-muted-foreground"
            >
              Later
            </button>
          </div>
        </div>
      </motion.div>

      {/* Form sheet */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[420px] max-h-[calc(100vh-var(--keyboard-inset,0px)-4rem)] overflow-y-auto rounded-[28px] p-0 border-0 bg-card/95 backdrop-blur-xl gap-0">
          <div className="px-5 pt-5 pb-2">
            <DialogHeader>
              <DialogTitle className="text-[17px] font-semibold tracking-tight text-center">
                How did {pending.name} go?
              </DialogTitle>
            </DialogHeader>
          </div>

          <div className="px-5 pb-5 space-y-4">
            {/* Performance feeling */}
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                How did you feel?
              </label>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Performance feeling">
                {FEELING_CHIPS.map((chip) => {
                  const active = feeling === chip.value;
                  return (
                    <button
                      key={chip.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        triggerHapticSelection();
                        setFeeling(chip.value);
                      }}
                      className={`h-11 rounded-xs text-[13px] font-semibold transition-colors ${
                        active ? chip.tone : "bg-muted/40 text-muted-foreground/85 active:bg-muted/60"
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional rebound */}
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                Rebound in 24h (kg, optional)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={reboundKg}
                onChange={(e) => setReboundKg(e.target.value)}
                placeholder="How much you put back on after weigh-in"
                className="h-11 rounded-xs tabular-nums"
              />
            </div>

            {/* Optional notes */}
            <div>
              <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground/70 block mb-1.5">
                What would you change? (optional)
              </label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you'd do differently next camp"
                className="h-11 rounded-xs"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  triggerHapticSelection();
                  setOpen(false);
                }}
                className="flex-1 h-11 rounded-xs"
              >
                Later
              </Button>
              <Button
                type="button"
                disabled={!feeling || saving}
                onClick={submit}
                className="flex-1 h-11 rounded-xs"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save debrief"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
