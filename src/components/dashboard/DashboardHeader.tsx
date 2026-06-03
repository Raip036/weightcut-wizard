import { memo, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface DashboardHeaderProps {
  avatarUrl?: string | null;
  userName?: string | null;
  daysUntilTarget: number;
  /** Kg remaining to the weigh-in target. Positive = still has to cut. */
  kgRemaining?: number | null;
  /** ISO date of weigh-in. Used to derive a short Mon-D label and progress. */
  targetDateISO?: string | null;
  /** Camp start date (ISO). Used to compute the ring fill %. */
  campStartISO?: string | null;
  /** Pace verdict; tints the ring. Defaults to neutral. */
  paceState?: "ok" | "behind" | "ahead" | null;
  onAvatarClick: () => void;
}

const GLASS_STYLE: React.CSSProperties = {
  background: "rgba(0, 5, 19, 0.6)",
  backdropFilter: "blur(20px) saturate(160%)",
  WebkitBackdropFilter: "blur(20px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.08)",
};

const RING_RADIUS = 14;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export const DashboardHeader = memo(function DashboardHeader({
  avatarUrl,
  userName,
  daysUntilTarget,
  kgRemaining,
  targetDateISO,
  campStartISO,
  paceState,
  onAvatarClick,
}: DashboardHeaderProps) {
  // Ring fill = % of camp elapsed. Falls back to 0 (empty ring) when we
  // don't have a start date — the day count alone still carries the
  // primary signal.
  const progressPct = useMemo(() => {
    if (!campStartISO || !targetDateISO) return 0;
    const startTs = Date.parse(campStartISO);
    const targetTs = Date.parse(targetDateISO);
    if (!Number.isFinite(startTs) || !Number.isFinite(targetTs) || targetTs <= startTs) {
      return 0;
    }
    const total = targetTs - startTs;
    const elapsed = Date.now() - startTs;
    return Math.max(0, Math.min(1, elapsed / total));
  }, [campStartISO, targetDateISO]);

  const ringColorClass =
    paceState === "behind"
      ? "stroke-amber-300"
      : paceState === "ahead"
        ? "stroke-sky-300"
        : "stroke-func-recovery-green";

  const weighInLabel = shortDate(targetDateISO);
  const hasContext =
    (typeof kgRemaining === "number" && kgRemaining > 0) || !!weighInLabel;

  return (
    <div className="pb-1.5">
      <header className="relative flex items-center justify-between gap-3 pt-1">
        <button
          onClick={onAvatarClick}
          className="active:opacity-70 transition-opacity"
          aria-label="Edit profile"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback
              className="text-note font-semibold"
              style={{ backgroundColor: "#162137", color: "#8C96B4" }}
            >
              {userName?.[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </Avatar>
        </button>

        {daysUntilTarget > 0 && (
          <div
            className="flex items-center gap-2.5 h-10 pl-1.5 pr-3 rounded-full"
            style={GLASS_STYLE}
            aria-label={`${daysUntilTarget} days until weigh-in`}
          >
            <div className="relative h-9 w-9 shrink-0">
              <svg
                viewBox="0 0 36 36"
                className="h-9 w-9 -rotate-90"
                aria-hidden
              >
                <circle
                  cx={18}
                  cy={18}
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth={2.5}
                  className="stroke-white/10"
                />
                <circle
                  cx={18}
                  cy={18}
                  r={RING_RADIUS}
                  fill="none"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeDasharray={`${progressPct * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                  className={ringColorClass}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[12px] font-bold tabular-nums leading-none text-foreground">
                  {daysUntilTarget}
                </span>
              </div>
            </div>
            {hasContext ? (
              <div className="leading-tight">
                {typeof kgRemaining === "number" && kgRemaining > 0 ? (
                  <p className="text-[11.5px] font-semibold text-foreground tabular-nums leading-tight">
                    {kgRemaining.toFixed(1)} kg
                  </p>
                ) : (
                  <p className="text-[11.5px] font-semibold text-func-recovery-green leading-tight">
                    On target
                  </p>
                )}
                {weighInLabel && (
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80 leading-tight mt-0.5">
                    weigh-in {weighInLabel}
                  </p>
                )}
              </div>
            ) : (
              <div className="leading-tight">
                <p className="text-[11.5px] font-semibold text-foreground tabular-nums">
                  days left
                </p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/80">
                  to weigh-in
                </p>
              </div>
            )}
          </div>
        )}
      </header>

      {/* Date — small caps Inter Light. Hugs the avatar row above (tight
          mt) so it reads as a unit; the wrapper's pb-1.5 + the parent
          space-y gap give it breathing room from the ring below. */}
      <div className="mt-2.5 pl-0.5">
        <p className="text-micro uppercase tracking-[0.15em] font-light text-muted-foreground/70">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </div>
  );
});

DashboardHeader.displayName = "DashboardHeader";
