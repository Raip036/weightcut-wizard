// WP-T18: ProtocolSectionDivider
// Visual chapter break used between major sections on the Weight Protocol
// screen (e.g. "Before the scale" → "After the scale"). Renders a hairline
// rule on either side of a small uppercase label. No animation by design;
// it's a purely structural marker.
export interface ProtocolSectionDividerProps {
  label: string;
  className?: string;
}

export function ProtocolSectionDivider({
  label,
  className = "",
}: ProtocolSectionDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      className={`flex items-center gap-3 py-2 ${className}`.trim()}
    >
      <span aria-hidden className="flex-1 border-t border-border/30" />
      <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70">
        {label}
      </span>
      <span aria-hidden className="flex-1 border-t border-border/30" />
    </div>
  );
}
