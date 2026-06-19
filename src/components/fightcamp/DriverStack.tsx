// DriverStack — composes 4 DriverRow's (Sleep, How you feel, Soreness,
// Training load) into a single accordion-style card. Owns the
// "which row is expanded" state (only one expanded at a time, matching
// the pillar accordion pattern elsewhere in Recovery).
//
// v1: deltas default to 0 (rendered as muted dash) — `prevReadiness` is
// plumbed through for future history-aware deltas. T12 (dashboard rewrite)
// can pass richer per-driver 7d series down.

import { useState } from "react";
import type { AllMetrics } from "@/utils/performanceEngine";
import { DriverRow } from "./DriverRow";

// ── Tone-band copy helpers ─────────────────────────────────────────────
// Exported so T12 and other surfaces (e.g. coach summaries) can reuse the
// same wording without duplicating thresholds.

export function sleepBandCopy(s: number): string {
  if (s >= 80) return "Slept like a champ";
  if (s >= 55) return "Solid sleep";
  if (s >= 35) return "Sleep was light";
  return "You slept poorly";
}

export function wellnessBandCopy(s: number): string {
  if (s >= 80) return "Dialled in";
  if (s >= 55) return "Feeling decent";
  if (s >= 35) return "Bit flat today";
  return "Body's telling you something";
}

export function sorenessBandCopy(s: number): string {
  if (s >= 80) return "Loose and fresh";
  if (s >= 55) return "Mild stiffness";
  if (s >= 35) return "Beat up";
  return "Hammered";
}

export function loadBandCopy(s: number): string {
  if (s >= 80) return "Streak going";
  if (s >= 55) return "Tracking well";
  if (s >= 35) return "Hard week";
  return "Red zone — back off";
}

// ── Detail helpers (1-sentence why) ────────────────────────────────────

function sleepDetail(m: AllMetrics): string {
  return `Last night ${m.latestSleep.toFixed(1)}h · 3-night avg ${m.avgSleepLast3.toFixed(1)}h`;
}

function wellnessDetail(m: AllMetrics): string {
  const h = m.hooperIndex ?? null;
  return h != null ? `Hooper Index ${h}/28 today` : `Check in to get a personal read`;
}

function sorenessDetail(m: AllMetrics): string {
  return `7d average soreness ${m.avgSoreness7d.toFixed(1)}/10`;
}

function loadDetail(m: AllMetrics): string {
  if (!m.loadConfidence.isReliable) {
    return `Building baseline · ${m.loadConfidence.trainingDaysIn28d}/${m.loadConfidence.required} days`;
  }
  return `ACWR ${m.loadRatio.toFixed(2)} · ${m.weeklySessionCount} sessions this week`;
}

// ── Sparkline fallback ─────────────────────────────────────────────────
// Without richer per-driver 7d series in AllMetrics, render a graceful
// "lifting from zero" sparkline that lands on the current score. T12 can
// later swap these out for true 7d arrays.

function flatTailingSpark(currentScore: number): number[] {
  return [0, 0, 0, 0, 0, 0, currentScore];
}

export interface DriverStackProps {
  metrics: AllMetrics;
  /** Optional readiness score from the previous day. Reserved for future
   *  history-aware delta computation — currently unused. */
  prevReadiness: number | null;
}

export function DriverStack({ metrics, prevReadiness: _prevReadiness }: DriverStackProps) {
  // TODO: when day-over-day history is wired in, compute each driver's
  // delta vs its own 7d average (or vs yesterday's value) using
  // `_prevReadiness` and any breakdown history we land. v1 keeps deltas
  // at 0 so the row slot is occupied with a muted dash.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const toggle = (key: string) =>
    setExpandedKey((prev) => (prev === key ? null : key));

  const b = metrics.readiness.breakdown;

  // 7d series — v1 fallback: synthesize a flat-tail spark landing on the
  // current driver score. AllMetrics doesn't yet expose per-driver history;
  // when it does, swap these out without touching DriverRow.
  const sleep7d = flatTailingSpark(b.sleepScore);
  const wellness7d = flatTailingSpark(b.wellnessScore ?? 0);
  const soreness7d = flatTailingSpark(b.sorenessScore);
  // For load, use weeklySessionCount as the final point (still flat-tailing
  // synthetic — but it surfaces "did you train this week" at a glance).
  const load7d = flatTailingSpark(b.loadBalanceScore);

  // Wellness driver is null when there's no check-in yet (undefined). Pass
  // `null` straight through so the row renders a NEUTRAL state ("—", no red,
  // no delta, "Tap to check in") rather than a misleading red 0. A real low
  // score (e.g. 0 from a genuine bad check-in) is a number and still shows.
  const wellnessScore = b.wellnessScore ?? null;

  return (
    <div className="card-surface rounded-2xl border border-border/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
          Why
        </span>
        <span className="text-[10px] text-muted-foreground/40">·</span>
        <span className="text-[10px] text-muted-foreground/50 font-semibold">4 drivers</span>
      </div>
      <div className="divide-y divide-border/30">
        <DriverRow
          label="Sleep"
          weight={3}
          icon="moonOutline"
          oneLiner={sleepBandCopy(b.sleepScore)}
          delta={0}
          score={b.sleepScore}
          sparkline7d={sleep7d}
          detail={sleepDetail(metrics)}
          expanded={expandedKey === "sleep"}
          onToggle={() => toggle("sleep")}
        />
        <DriverRow
          label="How you feel"
          weight={2}
          icon="heartOutline"
          oneLiner={wellnessScore == null ? "Not checked in yet" : wellnessBandCopy(wellnessScore)}
          delta={0}
          score={wellnessScore}
          sparkline7d={wellness7d}
          detail={wellnessDetail(metrics)}
          expanded={expandedKey === "wellness"}
          onToggle={() => toggle("wellness")}
        />
        <DriverRow
          label="Soreness"
          weight={2}
          icon="bodyOutline"
          oneLiner={sorenessBandCopy(b.sorenessScore)}
          delta={0}
          score={b.sorenessScore}
          sparkline7d={soreness7d}
          detail={sorenessDetail(metrics)}
          expanded={expandedKey === "soreness"}
          onToggle={() => toggle("soreness")}
        />
        <DriverRow
          label="Training load"
          weight={1}
          icon="barbellOutline"
          oneLiner={loadBandCopy(b.loadBalanceScore)}
          delta={0}
          score={b.loadBalanceScore}
          sparkline7d={load7d}
          detail={loadDetail(metrics)}
          expanded={expandedKey === "load"}
          onToggle={() => toggle("load")}
        />
      </div>
    </div>
  );
}
