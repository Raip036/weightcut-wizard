// WP-T17: DoNotCallouts
// Compact inset note listing 5-7 safety "do not" warnings on the
// Weight Protocol page. Always visible (free + Pro), no interaction,
// no mount animation; these are safety callouts so they need to be
// readable immediately.
//
// Visual conventions:
//   - surface-inset container with 3px danger-red left rail
//   - 11px uppercase bold "Do not" header with warning icon chip
//   - Bullet list using small danger-red dot (no native list-disc)
//   - 12px muted-foreground body for compactness
import { Icon } from "@/components/ui/Icon";

export interface DoNotCalloutsProps {
  /** 5-7 stark warnings, e.g. "Slam plain water post-weigh-in". */
  items: string[];
  className?: string;
}

export function DoNotCallouts({ items, className = "" }: DoNotCalloutsProps) {
  // Edge case: render nothing when there are no items so the page
  // doesn't show an empty red box. Parent decides when to provide
  // callouts (typically once a protocol exists).
  if (!items || items.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Things to avoid"
      className={`rounded-2xl surface-inset p-3.5 relative overflow-hidden ${className}`}
    >
      {/* 3px danger-red left rail */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-func-danger-red/70" />

      {/* Header: icon chip + "Do not" label */}
      <div className="flex items-center gap-2 mb-2.5 pl-1">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-func-danger-red/[0.16]">
          <Icon name="warningOutline" size={12} className="text-func-danger-red" />
        </div>
        <p className="text-[11px] uppercase font-bold tracking-[0.16em] leading-none text-func-danger-red">
          Do not
        </p>
      </div>

      {/* Bullet list: manual dot so we control colour precisely */}
      <ul className="space-y-1.5 pl-1">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="flex gap-2 text-[12px] text-muted-foreground leading-snug"
          >
            <span
              aria-hidden="true"
              className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-func-danger-red/70"
            />
            <span className="flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
