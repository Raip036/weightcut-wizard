import type { DayProjection } from "@/utils/fightWeekEngine";

interface DayTimelineCardProps {
  timeline: DayProjection[];
}

export function DayTimelineCard({ timeline }: DayTimelineCardProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">
        Day-by-Day Protocol
      </h3>
      <div className="space-y-2">
        {timeline.map((day) => (
          <div
            key={day.day}
            className="card-surface rounded-xs border border-border/50 p-4 space-y-3"
          >
            {/* Day header */}
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{day.label}</span>
              <span className="text-sm font-mono text-muted-foreground">
                {day.projectedWeight.toFixed(1)}kg
              </span>
            </div>

            {/* Metric pills */}
            <div className={`grid gap-2 ${day.calorieTarget ? "grid-cols-5" : "grid-cols-4"}`}>
              <MetricPill label="Carbs" value={`${day.carbTarget_g}g`} />
              {day.calorieTarget !== undefined && (
                <MetricPill label="Cals" value={`${day.calorieTarget}`} />
              )}
              <MetricPill label="Fluid" value={formatFluid(day.fluidTarget_ml)} />
              <MetricPill label="Fibre" value={`${day.fibreTarget_g}g`} />
              <MetricPill label="Na+" value={formatSodium(day.sodiumTarget_mg)} />
            </div>

            {/* Action notes */}
            {day.actions.length > 0 && (
              <div className="space-y-1">
                {day.actions.map((action, i) => (
                  <p key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-primary mt-px">-</span>
                    {action}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-xs p-2 text-center space-y-0.5">
      <span className="text-[9px] text-muted-foreground uppercase block">{label}</span>
      <span className="text-xs font-bold block">{value}</span>
    </div>
  );
}

function formatFluid(ml: number): string {
  if (ml >= 1000) return `${(ml / 1000).toFixed(1)}L`;
  return `${ml}ml`;
}

function formatSodium(mg: number): string {
  if (mg >= 1000) return `${(mg / 1000).toFixed(1)}g`;
  return `${mg}mg`;
}
