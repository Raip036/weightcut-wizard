interface MacroDonutProps {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  size?: number;
}

export function MacroDonut({ protein, carbs, fat, calories, size = 40 }: MacroDonutProps) {
  const pCal = protein * 4;
  const cCal = carbs * 4;
  const fCal = fat * 9;
  const macroTotal = pCal + cCal + fCal;

  const R = size * 0.39; // ~22 for 56px, ~15.6 for 40px
  const CIRC = 2 * Math.PI * R;
  const strokeW = size * 0.09; // ~5 for 56px, ~3.6 for 40px

  const pArc = macroTotal > 0 ? (pCal / macroTotal) * CIRC : 0;
  const cArc = macroTotal > 0 ? (cCal / macroTotal) * CIRC : 0;
  const fArc = macroTotal > 0 ? (fCal / macroTotal) * CIRC : 0;

  const center = size / 2;
  const fontSize = size * 0.25;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={center} cy={center} r={R} fill="none" stroke="hsl(var(--border) / 0.15)" strokeWidth={strokeW} />
        {macroTotal > 0 ? (
          <>
            {/* Design System v1 FUNCTIONAL palette: Protein/Carbs/Fats */}
            <circle cx={center} cy={center} r={R} fill="none" stroke="#2A5BDD" strokeWidth={strokeW}
              strokeDasharray={`${pArc} ${CIRC - pArc}`} strokeDashoffset={0} strokeLinecap="butt" />
            <circle cx={center} cy={center} r={R} fill="none" stroke="#F08439" strokeWidth={strokeW}
              strokeDasharray={`${cArc} ${CIRC - cArc}`} strokeDashoffset={-pArc} strokeLinecap="butt" />
            <circle cx={center} cy={center} r={R} fill="none" stroke="#7B31EA" strokeWidth={strokeW}
              strokeDasharray={`${fArc} ${CIRC - fArc}`} strokeDashoffset={-(pArc + cArc)} strokeLinecap="butt" />
          </>
        ) : calories > 0 ? (
          <circle cx={center} cy={center} r={R} fill="none" stroke="hsl(var(--muted-foreground) / 0.3)" strokeWidth={strokeW} />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold tabular-nums" style={{ fontSize }}>{calories}</span>
      </div>
    </div>
  );
}
