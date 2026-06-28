// THROWAWAY chart-lab shared data + helpers. Delete after sign-off.
// Mirrors the real PhaseCoachCard inputs (start 83.3 → 80.0 now → target 79.4)
// so every variant is judged on identical data and identical scales.

export interface Pt {
  ts: number;
  kg: number;
}

const DAY = 86_400_000;
// Anchor everything to a fixed "today" so the lab is deterministic (no Date.now
// jitter between screenshots). Camp started 30 days ago.
export const TODAY_TS = Date.parse("2026-07-03T00:00:00Z");
const START_TS = TODAY_TS - 30 * DAY;

// Realistic noisy daily weigh-ins: a downward drift with day-to-day water swing,
// the kind of jagged signal that makes the current chart look "compressed".
const RAW_KG = [
  83.3, 83.0, 83.4, 82.6, 82.9, 82.3, 82.0, 82.4, 81.7, 81.9,
  81.5, 81.8, 81.3, 81.6, 81.0, 81.3, 80.9, 81.2, 80.7, 81.0,
  80.6, 80.9, 80.4, 80.7, 80.3, 80.6, 80.2, 80.4, 80.1, 80.0,
];

export const MOCK_LOGS: Pt[] = RAW_KG.map((kg, i) => ({
  ts: START_TS + i * DAY,
  kg,
}));

/**
 * Calm trend series: a centered weighted moving average over the raw weigh-ins.
 * Daily weight is dominated by water/glycogen swing; the camp story is the TREND.
 * Smoothing the DATA (not just the path) is what turns the jagged spark into the
 * clean descending curve Apple Health shows. Endpoints are preserved so "start"
 * and "now" stay truthful.
 */
function smoothSeries(pts: Pt[], radius = 2): Pt[] {
  const weights = [1, 2, 3, 2, 1]; // centered, triangular
  return pts.map((p, i) => {
    let sum = 0;
    let wsum = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= pts.length) continue;
      const w = weights[k + radius];
      sum += pts[j].kg * w;
      wsum += w;
    }
    return { ts: p.ts, kg: sum / wsum };
  });
}

export const SMOOTH_LOGS: Pt[] = smoothSeries(MOCK_LOGS);

export const START_KG = RAW_KG[0];
export const CURRENT_KG = RAW_KG[RAW_KG.length - 1];
export const TARGET_KG = 79.4;
export const TARGET_TS = TODAY_TS + 24 * DAY; // weigh-in ~3.5 weeks out

// Week-by-week plan vertices (gentle straightening line to the weigh-in target).
export const MOCK_PLAN: Pt[] = [
  { ts: START_TS, kg: 83.3 },
  { ts: START_TS + 7 * DAY, kg: 82.4 },
  { ts: START_TS + 14 * DAY, kg: 81.4 },
  { ts: START_TS + 21 * DAY, kg: 80.5 },
  { ts: TODAY_TS, kg: 80.2 },
  { ts: TARGET_TS, kg: TARGET_KG },
];

/** Linear interp on ascending (ts,kg) plan points. */
export function interpolatePlan(points: Pt[], t: number): number {
  if (points.length === 0) return 0;
  if (t <= points[0].ts) return points[0].kg;
  const last = points[points.length - 1];
  if (t >= last.ts) return last.kg;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (t >= a.ts && t <= b.ts) {
      const frac = b.ts === a.ts ? 0 : (t - a.ts) / (b.ts - a.ts);
      return a.kg + (b.kg - a.kg) * frac;
    }
  }
  return last.kg;
}

export const PLAN_TODAY = interpolatePlan(MOCK_PLAN, TODAY_TS);
export const DRIFT_KG = CURRENT_KG - PLAN_TODAY; // ~0 → on plan (emerald)

export interface Scales {
  w: number;
  h: number;
  sx: (t: number) => number;
  sy: (kg: number) => number;
}

/**
 * Build x/y pixel scales over a viewBox. `w`/`h` are the SVG user units; pass a
 * viewBox whose aspect ratio matches the rendered box and DROP
 * preserveAspectRatio="none" to kill the stretch that squashes the real chart.
 */
export function buildScales(w = 320, h = 150, padX = 6, padY = 14): Scales {
  const allKg = [...MOCK_LOGS.map((p) => p.kg), ...MOCK_PLAN.map((p) => p.kg)];
  const yMax = Math.max(...allKg);
  const yMin = Math.min(...allKg);
  const yPad = Math.max(0.3, (yMax - yMin) * 0.14);
  const yLo = yMin - yPad;
  const yHi = yMax + yPad;

  const xLo = Math.min(MOCK_LOGS[0].ts, MOCK_PLAN[0].ts);
  const xHi = Math.max(TARGET_TS, TODAY_TS);

  const sx = (t: number) => padX + ((t - xLo) / (xHi - xLo)) * (w - padX * 2);
  const sy = (kg: number) => padY + ((yHi - kg) / (yHi - yLo)) * (h - padY * 2);
  return { w, h, sx, sy };
}

/** Straight-segment path (the current look). */
export function linePath(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/**
 * Monotone cubic (Fritsch–Carlson) smooth path. Never overshoots the data, so a
 * noisy weight series reads as a calm curve without inventing fake dips. This is
 * the single biggest "premium" upgrade over the straight-segment line.
 */
export function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 2) return "";
  if (n === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    slope[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slope[i - 1] + slope[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const hyp = a * a + b * b;
      if (hyp > 9) {
        const tau = 3 / Math.sqrt(hyp);
        m[i] = tau * a * slope[i];
        m[i + 1] = tau * b * slope[i];
      }
    }
  }
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const x1 = pts[i].x + dx[i] / 3;
    const y1 = pts[i].y + (m[i] * dx[i]) / 3;
    const x2 = pts[i + 1].x - dx[i] / 3;
    const y2 = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += ` C${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return d;
}

/** Map ts/kg points to pixel coords through scales. */
export function project(pts: Pt[], s: Scales): { x: number; y: number }[] {
  return pts.map((p) => ({ x: s.sx(p.ts), y: s.sy(p.kg) }));
}
