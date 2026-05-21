/**
 * Coach-side fight-form readout. Shows the athlete's current readiness
 * score, what's driving it, what's holding it back, and a 14-day trend.
 *
 * Design intent: big numbers, minimal copy, clearly grouped cards. The
 * coach should be able to read the panel in <5 seconds and know whether
 * to message the athlete and roughly what about.
 */
import type { FightFormDetail, FightFormSubKey } from "@/hooks/coach/useAthleteDetail";

const LABEL_DISPLAY: Record<FightFormDetail["label"], string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

const LABEL_COLOR: Record<FightFormDetail["label"], string> = {
  sharp: "text-func-recovery-green",
  sharpening: "text-func-warning-yellow",
  off_pace: "text-func-carbs-orange",
  at_risk: "text-func-danger-red",
};

const LABEL_RING: Record<FightFormDetail["label"], string> = {
  sharp: "stroke-func-recovery-green",
  sharpening: "stroke-func-warning-yellow",
  off_pace: "stroke-func-carbs-orange",
  at_risk: "stroke-func-danger-red",
};

const SUB_LABEL: Record<FightFormSubKey, string> = {
  training_load: "Training",
  sleep: "Sleep",
  weight_cut: "Weight Cut",
  wellness: "Wellness",
  nutrition_adherence: "Nutrition",
};

// Same thresholds the athlete-side scoring uses so coach + athlete read
// the same picture (sharpening band starts at 70, off_pace below 50).
const STRENGTH_THRESHOLD = 70;
const WEAKNESS_THRESHOLD = 50;

function CoachAction({ label }: { label: FightFormDetail["label"] }) {
  const copy: Record<FightFormDetail["label"], string> = {
    sharp: "Hold the line — small adjustments only.",
    sharpening: "Lean into the limiter this week.",
    off_pace: "Address the limiter before the next session.",
    at_risk: "Check in today. Pull back load if needed.",
  };
  return (
    <p className="text-[13px] text-foreground/80 leading-snug">
      {copy[label]}
    </p>
  );
}

function MiniRing({
  score,
  label,
  state,
  size = 96,
}: {
  score: number;
  label: FightFormDetail["label"];
  state: FightFormDetail["state"];
  size?: number;
}) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress =
    state === "ok" ? Math.max(0, Math.min(1, score / 100)) : 0;
  const dash = circumference * progress;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--muted))"
          strokeWidth={6}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className={`transition-all duration-500 ${
            state === "ok" ? LABEL_RING[label] : "stroke-muted-foreground/40"
          }`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-semibold tabular-nums leading-none">
          {state === "ok" ? score : "—"}
        </span>
      </div>
    </div>
  );
}

function TrendLine({
  trend,
  height = 36,
}: {
  trend: { date: string; score: number; state: string }[];
  height?: number;
}) {
  const points = trend.filter((t) => t.state === "ok");
  if (points.length < 2) {
    return (
      <p className="text-[11px] text-muted-foreground/70">
        {points.length === 0 ? "No history yet" : "Trend builds with more days"}
      </p>
    );
  }
  // Use an internal viewBox coordinate system and let the SVG scale to its
  // parent's width via `width="100%"`. A hardcoded pixel width was breaking
  // out of the FightFormPanel hero card on narrow viewports — the SVG sat
  // next to a 96px ring inside a flex row, and 220px + ring + gaps exceeded
  // the card's content width on smaller phones, so the chart overflowed
  // the card's right edge.
  const VB_WIDTH = 220;
  const min = 0;
  const max = 100;
  const stepX = VB_WIDTH / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.score - min) / (max - min)) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const lastY =
    height -
    ((points[points.length - 1].score - min) / (max - min)) * height;
  return (
    <svg
      viewBox={`0 0 ${VB_WIDTH} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden
      style={{ display: "block", maxWidth: "100%" }}
    >
      <path
        d={path}
        stroke="hsl(var(--primary))"
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        // Stroke width is in viewBox units; once the SVG stretches non-
        // uniformly via preserveAspectRatio="none" the visible stroke
        // would distort. `vector-effect: non-scaling-stroke` keeps the
        // line a consistent 2px regardless of horizontal scale.
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={(points.length - 1) * stepX}
        cy={lastY}
        r={3}
        fill="hsl(var(--primary))"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

type Props = {
  fightForm: FightFormDetail;
  trend: { date: string; score: number; state: string }[] | null;
};

export function FightFormPanel({ fightForm, trend }: Props) {
  const { label, score, state, sub_scores, top_driver, top_limiter } =
    fightForm;

  const subEntries = (Object.entries(sub_scores) as [FightFormSubKey, FightFormDetail["sub_scores"][FightFormSubKey]][])
    .map(([key, sub]) => ({ key, ...sub }));

  // "Doing well" = top driver + any other sub at/above 70. Sorted high → low.
  const strengths = subEntries
    .filter((s) => s.value >= STRENGTH_THRESHOLD || s.key === (top_driver as FightFormSubKey))
    .sort((a, b) => b.value - a.value);

  // "Needs work" = top limiter + any other sub below 50. Sorted low → high.
  const weaknesses = subEntries
    .filter((s) => s.value < WEAKNESS_THRESHOLD || s.key === (top_limiter as FightFormSubKey))
    .filter((s) => !strengths.some((x) => x.key === s.key))
    .sort((a, b) => a.value - b.value);

  return (
    <div className="space-y-3">
      {/* Hero card — score + label + trend */}
      <div className="card-surface rounded-xs border border-border p-4">
        <div className="flex items-center gap-4">
          <MiniRing score={score} label={label} state={state} size={96} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              Fight Form
            </p>
            <p
              className={`text-[22px] font-semibold leading-tight ${LABEL_COLOR[label]}`}
            >
              {state === "ok" ? LABEL_DISPLAY[label] : "Calibrating"}
            </p>
            <div className="mt-2 w-full overflow-hidden">
              <TrendLine trend={trend ?? []} />
            </div>
          </div>
        </div>
        {state === "ok" && (
          <div className="mt-3 pt-3 border-t border-border/40">
            <CoachAction label={label} />
          </div>
        )}
      </div>

      {/* What's working */}
      {state === "ok" && strengths.length > 0 && (
        <div className="card-surface rounded-xs border border-border p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-2">
            Doing well
          </p>
          <div className="space-y-2">
            {strengths.slice(0, 3).map((s) => (
              <div key={s.key} className="flex items-start gap-3">
                <div className="w-14 shrink-0">
                  <p className="text-[20px] font-semibold tabular-nums leading-none text-func-recovery-green">
                    {s.value}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium leading-tight">
                    {SUB_LABEL[s.key]}
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-snug truncate">
                    {s.reason.replace(/\s*—\s*/g, ", ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What needs work */}
      {state === "ok" && weaknesses.length > 0 && (
        <div className="card-surface rounded-xs border border-border p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-2">
            Needs work
          </p>
          <div className="space-y-2">
            {weaknesses.slice(0, 3).map((s) => (
              <div key={s.key} className="flex items-start gap-3">
                <div className="w-14 shrink-0">
                  <p
                    className={`text-[20px] font-semibold tabular-nums leading-none ${
                      s.value < 30
                        ? "text-func-danger-red"
                        : s.value < 50
                        ? "text-func-carbs-orange"
                        : "text-func-warning-yellow"
                    }`}
                  >
                    {s.value}
                  </p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium leading-tight">
                    {SUB_LABEL[s.key]}
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-snug truncate">
                    {s.reason.replace(/\s*—\s*/g, ", ")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {state === "calibrating" && (
        <div className="card-surface rounded-xs border border-border p-4 text-center">
          <p className="text-[13px] font-semibold mb-1">Score is calibrating</p>
          <p className="text-[12px] text-muted-foreground leading-snug">
            Needs a few more days of logs before the form score unlocks.
          </p>
        </div>
      )}
    </div>
  );
}
