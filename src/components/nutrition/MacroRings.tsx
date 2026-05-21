interface MacroRingProps {
  label: string;
  value: number;
  goal?: number;
  color: string;
  glowColor: string;
  unit?: string;
}

function MacroRing({ label, value, goal, color, glowColor, unit = "g" }: MacroRingProps) {
  const size = 80;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = goal && goal > 0 ? Math.min(value / goal, 1) : 0;
  const offset = circumference * (1 - progress);
  const filterId = `glow-${label}`;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          {/* Track ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-border/30"
          />
          {/* Progress ring */}
          {progress > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              filter={`url(#${filterId})`}
              style={{ transition: "stroke-dashoffset 0.6s ease" }}
            />
          )}
        </svg>
        {/* Center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display-number text-sm font-bold leading-none" style={{ color }}>
            {Math.round(value)}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground leading-none mt-0.5">
            {unit}
          </span>
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {goal && goal > 0 && (
        <span className="text-[9px] text-muted-foreground/60">/{Math.round(goal)}{unit}</span>
      )}
    </div>
  );
}

interface MacroRingsProps {
  protein: number;
  carbs: number;
  fats: number;
  proteinGoal?: number;
  carbsGoal?: number;
  fatsGoal?: number;
}

export function MacroRings({ protein, carbs, fats, proteinGoal, carbsGoal, fatsGoal }: MacroRingsProps) {
  return (
    <div className="card-surface p-4">
      <p className="text-xs uppercase tracking-widest text-muted-foreground text-center mb-3">Macros</p>
      <div className="grid grid-cols-3 gap-4 justify-items-center">
        {/* Macro colors come from Design System v1 FUNCTIONAL palette:
            Protein Blue / Carbs Orange / Fats Purple. Hardcoded hex (not
            CSS var) because the SVG `stroke` attribute doesn't read
            CSS vars in all WKWebView versions. */}
        <MacroRing
          label="Protein"
          value={protein}
          goal={proteinGoal}
          color="#2A5BDD"
          glowColor="#2A5BDD"
        />
        <MacroRing
          label="Carbs"
          value={carbs}
          goal={carbsGoal}
          color="#F08439"
          glowColor="#F08439"
        />
        <MacroRing
          label="Fats"
          value={fats}
          goal={fatsGoal}
          color="#7B31EA"
          glowColor="#7B31EA"
        />
      </div>
    </div>
  );
}
