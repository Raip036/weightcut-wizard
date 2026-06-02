/**
 * EmptyDashboardState — friendly first-run placeholder that appears in
 * place of the athlete list when a gym has zero accepted athletes yet.
 *
 * Visual: Apple Fitness glass card, soft primary glow, a single subtle
 * breath pulse on the icon ring to add a little life without distracting.
 * Two CTAs — copy the gym's invite code (fast) and share the invite via
 * the system share sheet (preferred on iOS). Reduced-motion respected.
 */
import { useState } from "react";
import { Check, Copy, Share2, Users } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { useToast } from "@/hooks/use-toast";
import { shareGymInvite } from "@/lib/shareInvite";

interface Props {
  gymName: string;
  inviteCode: string;
}

export function EmptyDashboardState({ gymName, inviteCode }: Props) {
  const prefersReduced = useReducedMotion();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    triggerHaptic(ImpactStyle.Light);
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      toast({ title: "Invite code copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleShare = async () => {
    triggerHaptic(ImpactStyle.Light);
    const result = await shareGymInvite({ gymName, code: inviteCode });
    if (result.via === "clipboard") {
      toast({ title: "Invite link copied", description: "Paste it anywhere" });
    } else if (result.via === "none") {
      toast({ title: "Could not share", variant: "destructive" });
    }
  };

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="glass-card rounded-2xl border border-primary/25 p-5 text-center relative overflow-hidden"
    >
      {/* Soft top wash — primary tint, very low opacity, decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] to-transparent"
      />

      <motion.div
        className="relative mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/12 ring-1 ring-primary/30"
        animate={prefersReduced ? undefined : { scale: [1, 1.04, 1] }}
        transition={
          prefersReduced
            ? undefined
            : { duration: 3, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <Users className="h-6 w-6 text-primary" strokeWidth={2.2} />
      </motion.div>

      <p className="relative text-[10px] font-bold uppercase tracking-[0.16em] text-primary/80">
        No fighters yet
      </p>
      <h2 className="relative mt-1 text-[17px] font-bold leading-tight">
        Get your roster in here
      </h2>
      <p className="relative mx-auto mt-1.5 max-w-[34ch] text-[12px] text-muted-foreground leading-snug">
        Share your gym code. Once fighters join, their readiness lands at the
        top of this page.
      </p>

      <div className="relative mt-4 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-center">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-muted/40 active:bg-muted/60 transition-colors"
          aria-label="Copy invite code"
        >
          <span className="font-mono text-[13px] font-semibold tracking-[0.18em] tabular-nums">
            {inviteCode}
          </span>
          {copied ? (
            <Check className="h-3.5 w-3.5 text-func-recovery-green" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.98] transition-transform"
          aria-label="Share gym invite"
        >
          <Share2 className="h-4 w-4" />
          Share invite
        </button>
      </div>
    </motion.div>
  );
}
