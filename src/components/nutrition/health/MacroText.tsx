interface MacroTextProps {
  protein_g: number;
  carbs_g: number;
  fats_g: number;
}

const MACROS = [
  { key: "p", color: "rgb(var(--func-protein-blue))" },
  { key: "c", color: "rgb(var(--func-carbs-orange))" },
  { key: "f", color: "rgb(var(--func-fats-purple))" },
] as const;

/**
 * Macro readout as colored TEXT only (no pill backgrounds): protein blue,
 * carbs orange, fat purple. The number carries the value, a faint "g" the unit.
 */
export function MacroText({ protein_g, carbs_g, fats_g }: MacroTextProps) {
  const values = [protein_g, carbs_g, fats_g];
  return (
    <div className="flex items-center gap-3 text-[12px] tabular-nums">
      {MACROS.map((m, i) => (
        <span key={m.key} className="font-semibold" style={{ color: m.color }}>
          {Math.round(values[i])}
          <span className="ml-0.5 text-[10px] font-medium opacity-60">g</span>
        </span>
      ))}
    </div>
  );
}
