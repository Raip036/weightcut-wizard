// WP-T11 — SafetyWarningBanner
// Amber or red banner used on the Weight Protocol page to surface
// safety guidance. Conditionally rendered by the page — when shown,
// it needs to be visible immediately, so we deliberately skip mount
// animations.
//
// Visual conventions:
//   - Amber: warningOutline icon, yellow border + faint tint
//   - Red:   alertCircleOutline icon, red border + faint tint
//   - 12px uppercase bold tracker title
//   - 13px muted body
//   - Optional "Read full safety brief →" link bottom-right
//   - aria-role: "alert" (red) vs "status" (amber) so screen readers
//     announce the red variant immediately but treat amber as polite.
import { Icon } from "@/components/ui/Icon";

export type SafetyLevel = "amber" | "red";

export interface SafetyWarningBannerProps {
  /** Severity — drives colour, icon, and aria role. */
  level: SafetyLevel;
  /** Short uppercase title, e.g. "SAFETY · cut depth above 5% body weight". */
  title: string;
  /** 1-2 sentence detail copy. */
  body: string;
  /** Optional "Read more" handler — when supplied, the bottom link renders. */
  onReadMore?: () => void;
  className?: string;
}

// Container chrome per level. Faint tint + border tone keeps the banner
// readable against the dark background without screaming.
function containerClasses(level: SafetyLevel): string {
  if (level === "red") {
    return "border border-func-danger-red/50 bg-func-danger-red/[0.05]";
  }
  return "border border-func-warning-yellow/40 bg-func-warning-yellow/[0.04]";
}

// Icon name + colour per level.
function iconConfig(level: SafetyLevel): {
  name: "warningOutline" | "alertCircleOutline";
  color: string;
} {
  if (level === "red") {
    return { name: "alertCircleOutline", color: "text-func-danger-red" };
  }
  return { name: "warningOutline", color: "text-func-warning-yellow" };
}

export function SafetyWarningBanner({
  level,
  title,
  body,
  onReadMore,
  className = "",
}: SafetyWarningBannerProps) {
  const { name: iconName, color: iconColor } = iconConfig(level);

  return (
    <div
      // Red = assertive (interrupts AT). Amber = polite (status region).
      role={level === "red" ? "alert" : "status"}
      aria-live={level === "red" ? "assertive" : "polite"}
      className={`card-surface rounded-2xl p-4 ${containerClasses(level)} ${className}`}
    >
      {/* Top row: icon + title */}
      <div className="flex items-start gap-2.5">
        <span className={`mt-px ${iconColor}`}>
          <Icon name={iconName} size={16} aria-label={level === "red" ? "Alert" : "Warning"} />
        </span>
        <p
          className={`text-[12px] uppercase font-bold tracking-[0.15em] leading-snug ${iconColor}`}
        >
          {title}
        </p>
      </div>

      {/* Body copy */}
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">{body}</p>

      {/* Optional read-more link */}
      {onReadMore && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onReadMore}
            className={`text-[12px] font-semibold ${iconColor} active:opacity-70 transition-opacity`}
          >
            Read full safety brief →
          </button>
        </div>
      )}
    </div>
  );
}
