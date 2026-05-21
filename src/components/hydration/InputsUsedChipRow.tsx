import { Pencil } from "lucide-react";

interface InputsUsedChipRowProps {
  weightLost: string;
  availableHours: number;
  glycogenDepletion: string;
  onEdit: () => void;
}

/**
 * Compact summary of the inputs that produced the current protocol.
 * Replaces the full form once the protocol is rendered so the focus
 * shifts to the output. "Edit" re-expands the form.
 */
export function InputsUsedChipRow({
  weightLost,
  availableHours,
  glycogenDepletion,
  onEdit,
}: InputsUsedChipRowProps) {
  const chips = [
    weightLost ? `${weightLost}kg lost` : null,
    `${availableHours}h window`,
    `${glycogenDepletion} depletion`,
  ].filter(Boolean) as string[];

  return (
    <div className="rounded-xs border border-border bg-muted/30 px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold mr-1">
        Inputs used
      </span>
      {chips.map((chip) => (
        <span
          key={chip}
          className="text-[11px] text-foreground/80 bg-background/60 border border-border/40 rounded-full px-2 py-0.5"
        >
          {chip}
        </span>
      ))}
      <button
        type="button"
        onClick={onEdit}
        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Edit inputs"
      >
        <Pencil className="h-3 w-3" />
        Edit
      </button>
    </div>
  );
}
