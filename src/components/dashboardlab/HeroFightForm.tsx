// MOCKUP - dashboard redesign lab. Delete after sign-off.
import { ChevronUp, ChevronDown, Flame } from "lucide-react";

interface HeroFightFormProps {
  score?: number;
  label?: string;
  deltaToday?: number;
  phase?: string;
}

export default function HeroFightForm({
  score = 82,
  label = "Sharp",
  deltaToday = 3,
  phase = "Camp - 18 days out",
}: HeroFightFormProps) {
  const clamped = Math.max(0, Math.min(100, score));

  // Ring geometry
  const size = 116;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (clamped / 100) * circumference;

  return (
    <div className="card-press card-glow relative overflow-hidden rounded-[22px] bg-card border border-white/[0.04] p-5">
      {/* Soft blue glow layer */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 30%, hsl(var(--primary)/0.18), transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Top row */}
        <div className="flex items-center justify-between gap-3">
          <span className="section-header">FIGHT FORM</span>
          <span
            className="rounded-full px-3 py-1 text-xs text-primary"
            style={{ backgroundColor: "hsl(var(--primary)/0.12)" }}
          >
            {phase}
          </span>
        </div>

        {/* Main row */}
        <div className="mt-6 flex items-center justify-between gap-4">
          {/* Left: number + label + delta */}
          <div>
            <div className="font-display display-number font-bold tracking-tight text-6xl leading-none">
              {clamped}
            </div>
            <div className="mt-2 text-base font-semibold">{label}</div>

            {deltaToday !== 0 && (
              <div
                className="mt-1 flex items-center gap-1 text-xs"
                style={{
                  color:
                    deltaToday > 0
                      ? "hsl(var(--success))"
                      : "hsl(var(--muted-foreground))",
                }}
              >
                {deltaToday > 0 ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span>
                  {deltaToday > 0 ? "+" : ""}
                  {deltaToday} today
                </span>
              </div>
            )}
          </div>

          {/* Right: score ring */}
          <div
            className="relative shrink-0"
            style={{ width: size, height: size }}
          >
            <svg width={size} height={size} className="block">
              <defs>
                <linearGradient id="ffGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="hsl(var(--primary))" />
                  <stop offset="100%" stopColor="hsl(var(--secondary))" />
                </linearGradient>
              </defs>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth={stroke}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="url(#ffGrad)"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${progress} ${circumference}`}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            </svg>

            {/* Ring center */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Flame className="h-5 w-5 text-primary" />
              <span className="mt-1 text-xs text-muted-foreground">/100</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
