// ApproachInfoSheet — explainer bottom sheet for the cut-approach
// selector. Renders three stacked cards (Gradual / Standard / Aggressive)
// with tone-coded borders/icons plus a footer note about the 8% safety
// override. Composed with the same <Sheet>/<SheetContent>/<VisuallyHidden>
// pattern as WellnessCheckInSheet in RecoveryDashboard so behaviour
// matches the rest of the app (drag handle, custom close button,
// safe-area-aware bottom padding).
import { motion, useReducedMotion } from "motion/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Icon, type IonIconName } from "@/components/ui/Icon";

export interface ApproachInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ApproachCardSpec {
  key: "gradual" | "standard" | "aggressive";
  icon: IonIconName;
  iconColor: string;
  border: string;
  background: string;
  title: string;
  subtitle: string;
  bestFor: string;
  tradeoff: string;
}

const APPROACHES: ReadonlyArray<ApproachCardSpec> = [
  {
    key: "gradual",
    icon: "leafOutline",
    iconColor: "text-blue-300",
    border: "border-blue-300/30",
    background: "bg-blue-300/[0.04]",
    title: "Gradual · 6–7 day taper",
    subtitle: "Smooth, low-stress cut.",
    bestFor:
      "First-time cutters, cuts under 4% body weight, or anyone who responds poorly to aggressive depletion.",
    tradeoff:
      "Slower glycogen loss across the week. More planning time, less acute discomfort.",
  },
  {
    key: "standard",
    icon: "pulseOutline",
    iconColor: "text-primary",
    border: "border-primary/30",
    background: "",
    title: "Standard · 5 day taper",
    subtitle: "The default — most fighters use this.",
    bestFor:
      "Cuts of 4–6% body weight with normal training load and adequate sleep.",
    tradeoff:
      "Balanced cost. Glycogen depletes hard from T-3, water restriction from T-1.",
  },
  {
    key: "aggressive",
    icon: "flameOutline",
    iconColor: "text-func-warning-yellow",
    border: "border-func-warning-yellow/30",
    background: "bg-func-warning-yellow/[0.04]",
    title: "Aggressive · 3–4 day taper",
    subtitle: "Front-loaded cut for veterans.",
    bestFor:
      "Experienced cutters cutting 5–7% who prefer to compress the discomfort window.",
    tradeoff:
      "Higher physiological cost. Avoid if sleep is below 6.5 h/night or if you have a history of pulled cuts.",
  },
];

function ApproachCard({
  spec,
  index,
}: {
  spec: ApproachCardSpec;
  index: number;
}): JSX.Element {
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        prefersReduced
          ? { duration: 0 }
          : {
              delay: 0.05 + index * 0.05,
              type: "spring",
              damping: 24,
              stiffness: 280,
            }
      }
      className={`rounded-2xl border ${spec.border} ${spec.background} p-4`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`h-10 w-10 shrink-0 rounded-xl border ${spec.border} flex items-center justify-center ${spec.iconColor}`}
        >
          <Icon name={spec.icon} size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold leading-tight text-foreground">
            {spec.title}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">
            {spec.subtitle}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <p className="text-[12.5px] leading-snug text-foreground/90">
          <span className="font-semibold text-foreground">Best for: </span>
          <span className="text-muted-foreground">{spec.bestFor}</span>
        </p>
        <p className="text-[12.5px] leading-snug text-foreground/90">
          <span className="font-semibold text-foreground">Trade-off: </span>
          <span className="text-muted-foreground">{spec.tradeoff}</span>
        </p>
      </div>
    </motion.div>
  );
}

export function ApproachInfoSheet({
  open,
  onOpenChange,
}: ApproachInfoSheetProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <VisuallyHidden>
          <SheetTitle>Cut approach</SheetTitle>
        </VisuallyHidden>
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="w-10 h-1 rounded-full bg-muted-foreground/25"
            aria-hidden
          />
        </div>
        <div className="flex items-center justify-between px-5 pt-2 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
              Weight protocol
            </p>
            <h2 className="text-[19px] font-bold tracking-tight">
              Cut approach
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
          >
            <Icon name="closeOutline" size={16} />
          </button>
        </div>
        <div className="px-5 pb-5 space-y-3">
          {APPROACHES.map((spec, i) => (
            <ApproachCard key={spec.key} spec={spec} index={i} />
          ))}
          <p className="pt-1 text-[11.5px] italic leading-snug text-muted-foreground">
            Cuts above 8% body weight are automatically forced to Gradual
            regardless of your selection — see the safety warning at the top
            of the page.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
