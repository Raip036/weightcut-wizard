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

/**
 * Map a cryptic safety-warning CODE (emitted by the fight-plan generator,
 * see `convex/_shared/weightProtocolMath.ts` → `buildSafetyWarnings`) to a
 * short, human-readable title for the banner.
 *
 * Lookup is case-insensitive on the code. Unknown codes fall back to a
 * title-cased version of the code (underscores → spaces, words capitalised)
 * so anything new the generator emits is still at least readable.
 */
export function friendlyWarningTitle(code: string): string {
  const KNOWN: Record<string, string> = {
    depth_gt_8pct: "Aggressive weight cut",
    aggressive_timeline: "Not enough time to cut",
    first_timer_deep_cut: "Big cut for a first timer",
    prior_high_rebound: "History of heavy rebound",
    sleep_debt: "Running on low sleep",
    low_readiness: "Recovery is low right now",
    female_cap: "Tighter safety margin",
  };

  const key = code.toLowerCase();
  if (key in KNOWN) {
    return KNOWN[key];
  }

  // Fallback: title-case the raw code so it stays readable.
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

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
      className={`card-surface rounded-2xl p-2.5 ${containerClasses(level)} ${className}`}
    >
      {/* Top row: icon + title */}
      <div className="flex items-start gap-1.5">
        <span className={`mt-px ${iconColor}`}>
          <Icon name={iconName} size={13} aria-label={level === "red" ? "Alert" : "Warning"} />
        </span>
        <p
          className={`text-[10px] uppercase font-bold tracking-[0.12em] leading-tight ${iconColor}`}
        >
          {title}
        </p>
      </div>

      {/* Body copy */}
      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{body}</p>

      {/* Optional read-more link */}
      {onReadMore && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onReadMore}
            className={`text-[10px] font-semibold ${iconColor} active:opacity-70 transition-opacity`}
          >
            Read full safety brief →
          </button>
        </div>
      )}
    </div>
  );
}
