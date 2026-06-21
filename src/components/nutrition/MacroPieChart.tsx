import { memo, useEffect, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";

interface MacroPieChartProps {
    calories: number;
    calorieTarget: number;
    protein: number;
    carbs: number;
    fats: number;
    proteinGoal?: number;
    carbsGoal?: number;
    fatsGoal?: number;
    onEditTargets?: () => void;
}

interface RingProps {
    pct: number;
    color: string;
    trackOpacity?: number;
    size: number;
    strokeWidth: number;
    children: ReactNode;
    glow?: boolean;
    mounted?: boolean;
}

// Full-circle progress ring, used by the three macro indicators.
const Ring = ({ pct, color, size, strokeWidth, children, trackOpacity = 0.18, glow = true, mounted = true }: RingProps) => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const clamped = Math.min(Math.max(pct, 0), 100);
    // Gate on mount so the arc grows from 0 → real value via the CSS transition.
    const shownPct = mounted ? clamped : 0;
    const offset = c - (shownPct / 100) * c;
    return (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke={`hsl(var(--border) / ${trackOpacity})`} strokeWidth={strokeWidth} />
                <circle cx={size / 2} cy={size / 2} r={r}
                    fill="none" stroke={color} strokeWidth={strokeWidth}
                    strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
                    className="transition-all duration-700 ease-out"
                    style={glow ? { filter: `drop-shadow(0 0 5px ${color}55)` } : undefined} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
                {children}
            </div>
        </div>
    );
};

interface MacroRingItemProps {
    label: string;
    value: number;
    goal: number;
    color: string;
    mounted?: boolean;
}

// Macro indicator: just the ring + label, NO card background. The three
// sit in a bare row under the calorie card.
const MacroRingItem = ({ label, value, goal, color, mounted }: MacroRingItemProps) => {
    const pct = goal > 0 ? (value / goal) * 100 : 0;
    const left = Math.max(0, goal - value);
    return (
        <div className="flex flex-col items-center justify-center gap-2">
            <Ring pct={pct} color={color} size={64} strokeWidth={7} mounted={mounted}>
                <span className="text-[15px] font-bold tabular-nums" style={{ color }}>
                    <AnimatedNumber value={value} className="text-[15px] font-bold tabular-nums" />
                    <span className="text-[9px] font-semibold ml-0.5" style={{ color }}>g</span>
                </span>
            </Ring>
            <div className="text-center">
                <p className="text-[12px] font-semibold text-foreground leading-none">{label}</p>
                <p className="text-[10px] tabular-nums text-muted-foreground/60 mt-1">
                    {goal > 0 ? `${Math.round(left)}g left` : "-"}
                </p>
            </div>
        </div>
    );
};

export const MacroPieChart = memo(function MacroPieChart({
    calories,
    calorieTarget,
    protein,
    carbs,
    fats,
    proteinGoal,
    carbsGoal,
    fatsGoal,
    onEditTargets,
}: MacroPieChartProps) {
    const isOver = calories > calorieTarget;
    const calPct = calorieTarget > 0 ? (calories / calorieTarget) * 100 : 0;
    const clamped = Math.min(Math.max(calPct, 0), 100);
    const calColor = isOver ? "hsl(var(--destructive))" : "hsl(var(--primary))";

    // On-load progress animation: every arc grows from 0 → real value once
    // mounted, riding the existing `transition-all duration-700 ease-out`.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        const id = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(id);
    }, []);

    // Semicircle gauge geometry. The arc sweeps 180° across the top of the
    // viewBox; `pathLength={100}` lets us drive the fill as a simple
    // percentage via strokeDasharray.
    const ARC = "M6 60 A54 54 0 0 1 114 60";

    return (
        <div className="space-y-2">
            {/* Calorie gauge: no card background; semicircle with Edit target top-right.
                No horizontal padding on this block so the "Edit target" button's right
                edge aligns flush with the right edge of the macro ring cards below. */}
            <div className="relative pt-1 pb-1">
                <div className="relative">
                    <p className="text-center text-[13px] uppercase tracking-[0.16em] font-bold text-foreground/80">
                        Calories
                    </p>
                    {onEditTargets && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onEditTargets(); }}
                            className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full bg-muted/40 border border-border/40 px-2.5 py-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted/60 active:scale-[0.97] transition"
                            aria-label="Edit calorie targets"
                        >
                            <Settings className="h-3 w-3" />
                            Edit target
                        </button>
                    )}
                </div>

                <div className="relative mx-auto mt-2 w-full max-w-[240px]">
                    <svg viewBox="0 0 120 68" className="w-full block">
                        <defs>
                            <linearGradient id="calorie-arc-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor={calColor} stopOpacity={0.65} />
                                <stop offset="100%" stopColor={calColor} stopOpacity={1} />
                            </linearGradient>
                        </defs>
                        <path
                            d={ARC}
                            fill="none"
                            stroke="hsl(var(--border) / 0.18)"
                            strokeWidth={8}
                            strokeLinecap="round"
                        />
                        <path
                            d={ARC}
                            fill="none"
                            stroke="url(#calorie-arc-grad)"
                            strokeWidth={8}
                            strokeLinecap="round"
                            pathLength={100}
                            strokeDasharray={`${mounted ? clamped : 0} 100`}
                            className="transition-all duration-700 ease-out"
                            style={{ filter: `drop-shadow(0 0 4px ${calColor}66) drop-shadow(0 0 10px ${calColor}44)` }}
                        />
                    </svg>
                    {/* Center readout: pushed lower so it sits centered in
                        the empty bowl of the gauge rather than up at the top. */}
                    <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
                        {/* Faint radial backlight behind the number; sits below
                            the readout so the digits stay crisp. */}
                        <div
                            className="pointer-events-none absolute inset-0 -z-10"
                            style={{ background: `radial-gradient(circle, ${calColor}22 0%, transparent 70%)` }}
                            aria-hidden="true"
                        />
                        <AnimatedNumber value={calories} className="text-[52px] font-bold tabular-nums leading-none tracking-tight text-foreground" />
                        {/* No target set → keep a unit label (no "left" pill in
                            this case). When a target exists, the "left" pill below
                            carries the context, so the old "of X kcal" line is dropped. */}
                        {calorieTarget <= 0 && (
                            <span className="text-[11px] text-muted-foreground/60 mt-1.5 tabular-nums font-medium">
                                kcal today
                            </span>
                        )}
                        {/* Remaining-calories pill: surfaces how many kcal are
                            left without crowding the gauge. Clamped at 0 so going
                            over reads "0 left" (the arc + number already turn red). */}
                        {calorieTarget > 0 && (
                            <span
                                className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                                    isOver
                                        ? "bg-destructive/10 text-destructive"
                                        : "bg-primary/10 text-primary"
                                }`}
                            >
                                {Math.max(0, calorieTarget - calories).toLocaleString()} left
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Macro rings: bare rings, no card backgrounds */}
            <div className="grid grid-cols-3 gap-3 mt-1">
                {/* Design System v1 FUNCTIONAL palette */}
                <MacroRingItem label="Protein" value={protein} goal={proteinGoal ?? 0} color="#2A5BDD" mounted={mounted} />
                <MacroRingItem label="Carbs" value={carbs} goal={carbsGoal ?? 0} color="#F08439" mounted={mounted} />
                <MacroRingItem label="Fat" value={fats} goal={fatsGoal ?? 0} color="#7B31EA" mounted={mounted} />
            </div>
        </div>
    );
});
