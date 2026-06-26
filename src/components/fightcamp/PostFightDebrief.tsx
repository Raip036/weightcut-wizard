import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import wizard from "@/assets/wizard_3D.png";

/**
 * Post-fight debrief prompt (Fight Camp Coach redesign, Phase 3, spec §5/§6).
 *
 * Renders nothing unless `getPendingDebrief` reports a past camp that still
 * needs a debrief. When one exists, shows a premium aurora prompt card ("How
 * did {camp} go?"); tapping it opens a form (feeling / optional rebound kg /
 * optional note). Submitting calls `recordDebrief`, which populates the
 * `fight_camps` retrospective fields the coach's cross-camp memory reads back.
 *
 * Visual language: the shared blue wizard-aurora look (WizardAuroraBackground +
 * wizard_3D mascot) used across the app's premium surfaces. Both the prompt
 * card and the form animate in and out.
 *
 * Mount once anywhere global (Dashboard/Camp). A separate agent owns mounting.
 */
const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;
const CTA_SOLID =
  "bg-primary text-primary-foreground shadow-[0_0_18px_hsl(217_91%_58%/0.5)] active:scale-[0.98]";

const FEELING_CHIPS = [
  { value: "strong",  label: "Strong",  tone: "text-func-recovery-green" },
  { value: "ok",      label: "OK",      tone: "text-primary" },
  { value: "drained", label: "Drained", tone: "text-func-warning-yellow" },
] as const;

/** Small floating wizard avatar with a radial glow, reused in card + dialog. */
function WizardAvatar({ size }: { size: number }) {
  const prefersReduced = useReducedMotion();
  return (
    <div className="relative grid place-items-center" style={{ height: size, width: size }}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.14)} 45%, transparent 70%)` }}
      />
      <motion.img
        src={wizard}
        alt=""
        draggable={false}
        className="relative object-contain"
        style={{ height: size * 0.82, width: size * 0.82, filter: `drop-shadow(0 0 12px ${hsl(0.5)})` }}
        animate={prefersReduced ? undefined : { y: [0, -4, 0] }}
        transition={prefersReduced ? undefined : { duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

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

  // Loading (undefined) or nothing pending (null) → render nothing. We keep
  // rendering when `dismissed` so the card can animate OUT via AnimatePresence.
  if (!pending) return null;

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

  const fieldLabel =
    "text-[11px] uppercase tracking-wider font-semibold text-white/55 block mb-2";
  const fieldClass =
    "h-12 rounded-2xl border-primary/20 bg-white/[0.04] text-[15px] text-foreground placeholder:text-muted-foreground/55 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/40 transition-shadow";

  return (
    <>
      {/* ── Premium aurora prompt card (animates in + out) ── */}
      <AnimatePresence>
        {!dismissed && (
          <motion.div
            className={className}
            initial={prefersReduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
          >
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 card-surface p-4">
              <WizardAuroraBackground intensity="subtle" />
              <div className="relative z-10 flex items-center gap-3">
                <WizardAvatar size={48} />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-white leading-snug truncate">
                    How did {pending.name} go?
                  </p>
                  <p className="text-[12px] text-white/55 leading-snug">
                    A quick debrief sharpens your next camp.
                  </p>
                </div>
              </div>

              <div className="relative z-10 mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setOpen(true);
                  }}
                  className={`flex-1 rounded-full px-4 py-2.5 text-[14px] font-bold transition-transform ${CTA_SOLID}`}
                >
                  Debrief
                </button>
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setDismissed(true);
                  }}
                  className="shrink-0 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white/45 active:text-white/70 transition-colors"
                >
                  Later
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Premium form (Radix Dialog keeps keyboard inset + a11y + in/out) ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[420px] max-h-[calc(100vh-var(--keyboard-inset,0px)-4rem)] overflow-y-auto rounded-[28px] p-0 border border-primary/20 bg-card/95 backdrop-blur-xl gap-0">
          {/* Aurora wash + centered glow behind the hero. */}
          <WizardAuroraBackground intensity="full" radialGlow className="rounded-[28px]" />

          <div className="relative z-10 px-5 pt-6 pb-2">
            <DialogHeader className="flex flex-col items-center gap-3">
              <WizardAvatar size={72} />
              <DialogTitle className="text-[19px] font-bold tracking-tight text-center text-white">
                How did {pending.name} go?
              </DialogTitle>
              <p className="text-[13px] text-white/55 text-center leading-snug -mt-1">
                Tell your coach how it went so the next camp is sharper.
              </p>
            </DialogHeader>
          </div>

          <div className="relative z-10 px-5 pb-6 pt-3 space-y-5">
            {/* Performance feeling */}
            <div>
              <span className={fieldLabel}>How did you feel?</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Performance feeling">
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
                      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-2xl border text-[13px] font-semibold transition-all active:scale-[0.97] ${
                        active
                          ? "border-primary/50 bg-primary/15 text-white shadow-[0_0_16px_hsl(217_91%_58%/0.35)]"
                          : "border-white/10 bg-white/[0.04] text-white/70"
                      }`}
                    >
                      <span className={active ? chip.tone : "text-white/50"}>{chip.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional rebound */}
            <div>
              <label htmlFor="debrief-rebound" className={fieldLabel}>
                Rebound in 24h (kg, optional)
              </label>
              <Input
                id="debrief-rebound"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={reboundKg}
                onChange={(e) => setReboundKg(e.target.value)}
                placeholder="Weight put back on after weigh-in"
                className={`${fieldClass} tabular-nums`}
              />
            </div>

            {/* Optional notes */}
            <div>
              <label htmlFor="debrief-notes" className={fieldLabel}>
                What would you change? (optional)
              </label>
              <Textarea
                id="debrief-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything you'd do differently next camp"
                rows={3}
                className="min-h-[88px] rounded-2xl border-primary/20 bg-white/[0.04] text-[15px] text-foreground placeholder:text-muted-foreground/55 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/40 transition-shadow resize-none"
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={!feeling || saving}
                onClick={submit}
                className={`flex h-12 items-center justify-center rounded-full text-[15px] font-bold transition-transform disabled:opacity-40 disabled:active:scale-100 ${CTA_SOLID}`}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save debrief"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  triggerHapticSelection();
                  setOpen(false);
                }}
                className="h-11 rounded-full text-[13px] font-semibold text-white/45 active:text-white/70 transition-colors disabled:opacity-40"
              >
                Later
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PostFightDebrief;
