/**
 * LevelRing — a pure SVG circular progress ring with a centred level number.
 *
 * Inspired by the Apple Fitness activity rings: a soft muted track underneath,
 * a saturated foreground arc on top, both rounded so the partial arc terminates
 * cleanly. The arc starts at 12 o'clock (via a -90° rotation on the SVG group)
 * and fills clockwise as `progress` (0..1) increases.
 *
 * Self-contained — no external dependencies beyond React. Discipline colour is
 * pulled from the CSS custom property passed in via `token` (e.g.
 * `"--coach-bjj"`).
 */
interface LevelRingProps {
  /** CSS custom-property name from `disciplineToken(sport)`, e.g. `"--coach-bjj"`. */
  token: string;
  /** Current level — rendered centred inside the ring. */
  level: number;
  /** Fraction (0..1) of progress toward the next level. */
  progress: number;
  /** Outer diameter in px. Defaults to 44 (Apple's minimum touch target). */
  size?: number;
  /** Stroke width in px. Defaults to 3. */
  strokeWidth?: number;
}

export function LevelRing({
  token,
  level,
  progress,
  size = 44,
  strokeWidth = 3,
}: LevelRingProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);
  const fontSize = size * 0.32;
  const labelPct = Math.round(clamped * 100);

  return (
    <svg
      role="img"
      aria-label={`Level ${level}, ${labelPct}% to next`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-shrink-0"
    >
      {/* Rotate -90° around the centre so the arc starts at 12 o'clock. */}
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted) / 0.3)"
          strokeWidth={strokeWidth}
        />
        {/* Foreground arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`hsl(var(${token}))`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 500ms ease" }}
        />
      </g>
      {/* Centred level number — not rotated, sits flat over the arc. */}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fill="hsl(var(--foreground))"
        fontSize={fontSize}
        className="font-bold tabular-nums"
      >
        {level}
      </text>
    </svg>
  );
}
