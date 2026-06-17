// WP — SealedRehydrationCard
// Shown in the "After the Scale" slot while the athlete is still cutting
// (pre weigh-in). The rehydration plan is genuinely meaningless until the
// scale reads — so instead of dumping the timeline / ORS / sweat-entry on
// a cutting athlete, we seal it behind a locked teaser with a quiet shine
// sweep. It unlocks (replaced by the live rehydration content) the moment
// the protocol enters the weigh-in window.
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";

interface SealedRehydrationCardProps {
  /** Days remaining; appended to the unlock pill ("· 5d") when > 0. */
  daysToWeighIn: number;
}

export function SealedRehydrationCard({
  daysToWeighIn,
}: SealedRehydrationCardProps) {
  const prefersReduced = useReducedMotion();

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/40 bg-muted/20 p-5">
      {/* Quiet diagonal shine, telegraphing "sealed but coming". */}
      {!prefersReduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.05) 50%, transparent 70%)",
          }}
          initial={{ x: "-120%" }}
          animate={{ x: "120%" }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
        />
      )}

      <div className="relative flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
          <Icon name="lockClosedOutline" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold tracking-tight text-foreground">
            After the Scale
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Rehydration timeline · ORS recipe
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
            Unlocks when you log your weigh-in
            {daysToWeighIn > 0 ? ` · ${daysToWeighIn}d` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
