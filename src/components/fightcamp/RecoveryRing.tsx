import { memo } from "react";

interface RecoveryRingProps {
  value: number;
  max: number;
  color: string;
  glowColor: string;
  label: string;
  size?: number;
  strokeWidth?: number;
  displayValue?: string;
  sublabel?: string;
}

export const RecoveryRing = memo(function RecoveryRing({
  value,
  max,
  color,
  glowColor,
  label,
  size = 110,
  strokeWidth = 10,
  displayValue,
  sublabel,
}: RecoveryRingProps) {
  const progress = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const viewBox = size;
  const center = viewBox / 2;
  const radius = (viewBox - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progress * circumference;

  // Unique ID for this ring's gradient/filter
  const id = label.replace(/\s+/g, '-').toLowerCase();

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          className="transform -rotate-90"
          width={size}
          height={size}
          viewBox={`0 0 ${viewBox} ${viewBox}`}
        >
          <defs>
            <linearGradient id={`grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.7" />
            </linearGradient>
            <filter id={`glow-${id}`}>
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={glowColor} floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            opacity={0.15}
          />

          {/* Progress arc */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={`url(#grad-${id})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            filter={`url(#glow-${id})`}
            className="transition-all duration-[800ms] ease-out"
          />
        </svg>

        {/* Center content: sizes scale with ring */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="display-number font-bold" style={{ color, fontSize: Math.max(10, size * 0.14) }}>
            {displayValue ?? Math.round(value)}
          </span>
          {sublabel && (
            <span className="text-muted-foreground uppercase tracking-wider" style={{ fontSize: Math.max(7, size * 0.09), marginTop: 1 }}>
              {sublabel}
            </span>
          )}
        </div>
      </div>

      <span className="uppercase tracking-widest text-muted-foreground font-medium" style={{ fontSize: Math.max(8, size * 0.07) }}>
        {label}
      </span>
    </div>
  );
});
