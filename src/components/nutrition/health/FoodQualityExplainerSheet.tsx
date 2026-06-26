import { Sprout, Factory } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";

interface FoodQualityExplainerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TIERS: Array<{ g: string; label: string; desc: string }> = [
  { g: "A", label: "Whole food", desc: "Real, single-ingredient food. Eat freely." },
  { g: "B", label: "Minimally processed", desc: "Lightly changed, still close to natural." },
  { g: "C", label: "Processed", desc: "Some refining or a few added ingredients." },
  { g: "D", label: "Highly processed", desc: "Several additives, far from whole." },
  { g: "E", label: "Ultra-processed", desc: "Industrial formula, little real food." },
];

/**
 * Bottom sheet that explains the food-quality grade: it rates how whole vs
 * processed your food is (not calories or macros), and nudges toward a
 * whole-food diet. Brand blue, positive framing, no shaming.
 */
export function FoodQualityExplainerSheet({ open, onOpenChange }: FoodQualityExplainerSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh]">
        <div
          className="overflow-y-auto px-5 pt-3"
          style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Header */}
          <DrawerTitle className="text-[19px] font-bold tracking-tight">
            How your food is graded
          </DrawerTitle>

          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            This grade rates how <span className="text-foreground font-semibold">whole and unprocessed</span> your
            food is, not its calories or macros. The closer your food is to its natural form, the higher it scores.
          </p>

          {/* A to E scale */}
          <div className="mt-5 space-y-1.5">
            {TIERS.map((t) => (
              <div key={t.g} className="flex items-center gap-3 rounded-xl bg-card/60 px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-white">
                  {t.g}
                </span>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold leading-tight">{t.label}</p>
                  <p className="text-[12px] leading-tight text-muted-foreground">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* High vs low, at a glance */}
          <div className="mt-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Sprout className="h-3.5 w-3.5 text-primary" />
              </span>
              <p className="text-[13.5px] leading-snug">
                <span className="font-semibold text-foreground">Whole foods score high.</span>{" "}
                <span className="text-muted-foreground">Steak, eggs, veg, fruit, oats, nuts.</span>
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50">
                <Factory className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <p className="text-[13.5px] leading-snug">
                <span className="font-semibold text-foreground/90">Ultra-processed scores low.</span>{" "}
                <span className="text-muted-foreground">Fast food, soda, crisps, candy, bars.</span>
              </p>
            </div>
          </div>

          {/* One-line credibility */}
          <p className="mt-4 text-[12px] leading-snug text-muted-foreground/70">
            Based on the NOVA food-science classification, so the same food always scores the same.
          </p>

          {/* Short nudge */}
          <div className="mt-4 rounded-2xl bg-primary/[0.07] px-4 py-3">
            <p className="text-[13.5px] font-semibold leading-snug text-foreground">Eat closer to the source.</p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              Keep most of your day in the A and B range.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mt-5 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground active:scale-[0.98] transition-transform"
          >
            Got it
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
