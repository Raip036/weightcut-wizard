import { memo, type ReactNode } from "react";
import { Settings } from "lucide-react";

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
}

// Full-circle progress ring — used by the three macro indicators.
const Ring = ({ pct, color, size, strokeWidth, children, trackOpacity = 0.18, glow = true }: RingProps) => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const clamped = Math.min(Math.max(pct, 0), 100);
    const offset = c - (clamped / 100) * c;
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
}

// Macro indicator — just the ring + label, NO card background. The three
// sit in a bare row under the calorie card.
const MacroRingItem = ({ label, value, goal, color }: MacroRingItemProps) => {
    const pct = goal > 0 ? (value / goal) * 100 : 0;
    const left = Math.max(0, goal - value);
    return (
        <div className="flex flex-col items-center justify-center gap-2">
            <Ring pct={pct} color={color} size={64} strokeWidth={7}>
                <span className="text-[15px] font-bold tabular-nums" style={{ color }}>
                    {Math.round(value)}
                    <span className="text-[9px] font-semibold ml-0.5" style={{ color }}>g</span>
                </span>
            </Ring>
            <div className="text-center">
                <p className="text-[12px] font-semibold text-foreground leading-none">{label}</p>
                <p className="text-[10px] tabular-nums text-muted-foreground/60 mt-1">
                    {goal > 0 ? `${Math.round(left)}g left` : "—"}
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

    // Semicircle gauge geometry. The arc sweeps 180° across the top of the
    // viewBox; `pathLength={100}` lets us drive the fill as a simple
    // percentage via strokeDasharray.
    const ARC = "M6 60 A54 54 0 0 1 114 60";

    return (
        <div className="space-y-5">
            {/* Calorie card — semicircle gauge centered, settings top-right */}
            <div className="relative card-surface rounded-xs px-6 pt-5 pb-6">
                {onEditTargets && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onEditTargets(); }}
                        className="absolute top-3 right-3 z-10 flex items-center justify-center text-muted-foreground/50 hover:text-primary transition-colors"
                        aria-label="Edit calorie targets"
                    >
                        <Settings className="h-4 w-4" />
                    </button>
                )}

                <p className="text-center text-[10px] uppercase tracking-[0.15em] font-semibold text-muted-foreground/60">
                    Calories
                </p>

                <div className="relative mx-auto mt-2 w-full max-w-[240px]">
                    <svg viewBox="0 0 120 68" className="w-full block">
                        <path
                            d={ARC}
                            fill="none"
                            stroke="hsl(var(--border) / 0.18)"
                            strokeWidth={10}
                            strokeLinecap="round"
                        />
                        <path
                            d={ARC}
                            fill="none"
                            stroke={calColor}
                            strokeWidth={10}
                            strokeLinecap="round"
                            pathLength={100}
                            strokeDasharray={`${clamped} 100`}
                            className="transition-all duration-700 ease-out"
                            style={{ filter: `drop-shadow(0 0 5px ${calColor}55)` }}
                        />
                    </svg>
                    {/* Center readout — sits in the bowl of the gauge */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pb-0.5">
                        <span className="text-[34px] font-bold tabular-nums leading-none tracking-tight text-foreground">
                            {Math.round(calories)}
                        </span>
                        <span className="text-[11px] text-muted-foreground/60 mt-1.5 tabular-nums font-medium">
                            {calorieTarget > 0
                                ? `of ${calorieTarget.toLocaleString()} kcal`
                                : "kcal today"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Macro rings — bare rings, no card backgrounds */}
            <div className="grid grid-cols-3 gap-3">
                {/* Design System v1 FUNCTIONAL palette */}
                <MacroRingItem label="Protein" value={protein} goal={proteinGoal ?? 0} color="#2A5BDD" />
                <MacroRingItem label="Carbs" value={carbs} goal={carbsGoal ?? 0} color="#F08439" />
                <MacroRingItem label="Fat" value={fats} goal={fatsGoal ?? 0} color="#7B31EA" />
            </div>
        </div>
    );
});
