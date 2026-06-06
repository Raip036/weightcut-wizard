import { AnimatedRing } from "@/components/motion/AnimatedRing";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { status } from "@/lib/dietAnalysis";

/** A single small animated micronutrient ring with a count-up percentage. */
export function NutrientRing({ name, percentRDA }: { name: string; percentRDA: number }) {
  const { color, label } = status(percentRDA);
  const progress = Math.min(percentRDA / 100, 1);
  return (
    <div
      className="flex flex-col items-center gap-1"
      role="img"
      aria-label={`${name}: ${percentRDA}% of daily target, ${label}`}
    >
      <div className="relative" style={{ width: 56, height: 56 }}>
        <AnimatedRing
          progress={progress}
          size={56}
          strokeWidth={5}
          gradientColors={[color, color]}
          id={`micro-${name.replace(/\s+/g, "-")}`}
        />
        <div className="absolute inset-0 flex items-center justify-center" style={{ color }}>
          <AnimatedNumber
            value={percentRDA}
            format={(n) => `${Math.round(n)}%`}
            className="text-[11px] font-bold tabular-nums"
          />
        </div>
      </div>
      <span className="text-[9px] text-muted-foreground/70 text-center leading-tight">
        {name}
      </span>
    </div>
  );
}
