// WP-T17: DoNotCallouts
// Stark, dark, attention-grabbing card listing 5-7 safety "do not"
// warnings on the Weight Protocol page. Always visible (free + Pro),
// no interaction, no mount animation; these are safety callouts so
// they need to be readable immediately.
//
// Visual conventions:
//   - Red-tinted container (faint danger-red bg + border)
//   - 12px uppercase bold tracker "DO NOT" header with warning icon
//   - Bullet list using subtle red dot glyph (no native list-disc)
//   - 13px foreground/90 body so the warnings read clearly against the
//     red-tinted background
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
      className={`rounded-2xl border border-func-danger-red/30 bg-func-danger-red/[0.04] p-5 ${className}`}
    >
      {/* Header: icon + "DO NOT" label */}
      <div className="flex items-center gap-2">
        <span className="text-func-danger-red">
          <Icon name="warningOutline" size={14} aria-label="Warning" />
        </span>
        <p className="text-[12px] uppercase font-bold tracking-[0.15em] leading-none text-func-danger-red">
          DO NOT
        </p>
      </div>

      {/* Bullet list: use a non-native bullet so we control colour & spacing.
          `list-none` + manual glyph keeps the dot a precise tone we can
          dim relative to the text. */}
      <ul className="mt-3 list-none space-y-2">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="flex gap-2 text-[13px] text-foreground/90 leading-snug"
          >
            <span
              aria-hidden="true"
              className="mt-[2px] text-func-danger-red/60 leading-none select-none"
            >
              •
            </span>
            <span className="flex-1">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
