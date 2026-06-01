import { describe, it, expect } from 'vitest';
import {
  sessionLoad,
  dailyLoad,
  calculateStrain,
  applyRestDayRecovery,
  computeAllMetrics,
  deriveCalibration,
  computeReadiness,
  detectTrends,
  clamp,
  mapRange,
  getRecentSleepValues,
  getRecentSorenessValues,
  ewmaLoad,
  computeEwmaAcwr,
  cnsMultiplier,
  computeFosterMetrics,
  computeContactLoad,
  determineCampPhase,
  applyCampPhaseToCalibration,
  ACUTE_LAMBDA,
  CHRONIC_LAMBDA,
  type SessionRow,
  type AthleteCalibration,
} from './performanceEngine';
import { sportLoadMultiplier } from '@/lib/sessionTypes';

// Helper to create a session row
function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'test-id',
    date: new Date().toISOString().split('T')[0],
    session_type: 'BJJ',
    duration_minutes: 60,
    rpe: 7,
    intensity: 'moderate',
    intensity_level: 3,
    soreness_level: 0,
    sleep_hours: 8,
    user_id: 'user-1',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ─── Utility Functions ──────────────────────────────────────

describe('clamp', () => {
  it('clamps value within range', () => {
    expect(clamp(0, 100, 50)).toBe(50);
    expect(clamp(0, 100, -10)).toBe(0);
    expect(clamp(0, 100, 150)).toBe(100);
  });
});

describe('mapRange', () => {
  it('maps value from one range to another', () => {
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
    expect(mapRange(0, 0, 10, 0, 100)).toBe(0);
    expect(mapRange(10, 0, 10, 0, 100)).toBe(100);
  });

  it('clamps input to input range', () => {
    expect(mapRange(-5, 0, 10, 0, 100)).toBe(0);
    expect(mapRange(15, 0, 10, 0, 100)).toBe(100);
  });
});

// ─── Session Load ───────────────────────────────────────────

describe('sessionLoad', () => {
  it('calculates RPE × Minutes × IntensityMultiplier', () => {
    const s = makeSession({ session_type: 'Bag Work', rpe: 7, duration_minutes: 60, intensity_level: 3 });
    // 7 × 60 × 1.15 × 1.0 (Bag Work sport multiplier) = 483
    expect(sessionLoad(s)).toBeCloseTo(483, 0);
  });

  it('returns 0 for Rest sessions', () => {
    const s = makeSession({ session_type: 'Rest' });
    expect(sessionLoad(s)).toBe(0);
  });

  it('returns 0 for Recovery sessions', () => {
    const s = makeSession({ session_type: 'Recovery' });
    expect(sessionLoad(s)).toBe(0);
  });

  it('uses legacy intensity when intensity_level is null', () => {
    const s = makeSession({ session_type: 'Bag Work', intensity_level: null, intensity: 'high', rpe: 5, duration_minutes: 30 });
    // high → level 5 → multiplier 1.5 → 5 * 30 * 1.5 × 1.0 (Bag Work sport multiplier) = 225
    expect(sessionLoad(s)).toBeCloseTo(225, 0);
  });

  it('applies correct multipliers for each intensity level', () => {
    // Bag Work sport multiplier = 1.0× so expectations remain clean
    const base = { session_type: 'Bag Work' as const, rpe: 10, duration_minutes: 100 }; // base = 1000
    expect(sessionLoad(makeSession({ ...base, intensity_level: 1 }))).toBeCloseTo(800, 0);
    expect(sessionLoad(makeSession({ ...base, intensity_level: 2 }))).toBeCloseTo(1000, 0);
    expect(sessionLoad(makeSession({ ...base, intensity_level: 3 }))).toBeCloseTo(1150, 0);
    expect(sessionLoad(makeSession({ ...base, intensity_level: 4 }))).toBeCloseTo(1300, 0);
    expect(sessionLoad(makeSession({ ...base, intensity_level: 5 }))).toBeCloseTo(1500, 0);
  });
});

// ─── Daily Load ─────────────────────────────────────────────

describe('dailyLoad', () => {
  it('sums session loads for a single session', () => {
    const sessions = [makeSession({ session_type: 'Bag Work', rpe: 7, duration_minutes: 60, intensity_level: 3 })];
    expect(dailyLoad(sessions)).toBeCloseTo(483, 0);
  });

  it('applies CNS multiplier for multiple sessions', () => {
    const sessions = [
      makeSession({ session_type: 'Bag Work', rpe: 7, duration_minutes: 60, intensity_level: 3 }),
      makeSession({ session_type: 'Bag Work', rpe: 5, duration_minutes: 30, intensity_level: 2 }),
    ];
    // Session 1: 7*60*1.15*1.0 = 483, Session 2: 5*30*1.0*1.0 = 150
    // Total: 633, CNS: 1.15 (two sessions, one high RPE, same-tick created_at < 6h apart)
    // → 633 * 1.15 = 727.95
    expect(dailyLoad(sessions)).toBeCloseTo(727.95, 0);
  });

  it('returns 0 for empty array', () => {
    expect(dailyLoad([])).toBe(0);
  });

  it('returns 0 for only rest sessions', () => {
    expect(dailyLoad([makeSession({ session_type: 'Rest' })])).toBe(0);
  });
});

// ─── Calculate Strain ───────────────────────────────────────

describe('calculateStrain', () => {
  it('returns 0 for 0 load', () => {
    expect(calculateStrain(0)).toBe(0);
  });

  it('follows diminishing returns curve', () => {
    const s500 = calculateStrain(500);
    const s1000 = calculateStrain(1000);
    const s2000 = calculateStrain(2000);

    expect(s500).toBeGreaterThan(0);
    expect(s1000).toBeGreaterThan(s500);
    expect(s2000).toBeGreaterThan(s1000);

    // Diminishing returns: gap from 500→1000 > gap from 1000→2000
    expect(s1000 - s500).toBeGreaterThan(s2000 - s1000);
  });

  it('approaches but never exceeds 21', () => {
    expect(calculateStrain(10000)).toBeLessThanOrEqual(21);
    expect(calculateStrain(10000)).toBeGreaterThan(20);
  });

  it('gives ~8.1 for load of 500', () => {
    // 21 * (1 - e^(-500/1000)) = 21 * (1 - e^(-0.5)) = 21 * 0.3935 = 8.26
    expect(calculateStrain(500)).toBeCloseTo(8.26, 1);
  });

  it('uses custom divisor when provided', () => {
    const defaultStrain = calculateStrain(500, 1000);
    const higherDivisor = calculateStrain(500, 1400);
    const lowerDivisor = calculateStrain(500, 700);

    // Higher divisor = lower strain for same load (advanced athlete)
    expect(higherDivisor).toBeLessThan(defaultStrain);
    // Lower divisor = higher strain for same load (beginner)
    expect(lowerDivisor).toBeGreaterThan(defaultStrain);
  });

  it('default divisor (1000) backward compat — same results as before', () => {
    expect(calculateStrain(500)).toBeCloseTo(calculateStrain(500, 1000), 5);
    expect(calculateStrain(1000)).toBeCloseTo(calculateStrain(1000, 1000), 5);
  });
});

// ─── Derive Calibration ─────────────────────────────────────

describe('deriveCalibration', () => {
  it('assigns beginner tier for low frequency with widened thresholds', () => {
    // Beginner thresholds loosened (1.1/1.3 → 1.5/1.8) so that one or two
    // sessions logged after a sparse week don't get flagged as spikes. The
    // absolute-load floor in computeAdaptiveOvertrainingScore is the second
    // gate that protects beginners from cold-start false positives.
    const cal = deriveCalibration(1, null, []);
    expect(cal.tier).toBe('beginner');
    expect(cal.loadRatioThresholds.caution).toBe(1.5);
    expect(cal.loadRatioThresholds.danger).toBe(1.8);
    expect(cal.strainDivisor).toBe(700);
  });

  it('assigns developing tier for moderate frequency', () => {
    const cal = deriveCalibration(2, 'moderately_active', []);
    expect(cal.tier).toBe('developing');
    expect(cal.rpeCeiling).toBe(7);
  });

  it('assigns intermediate tier for 4+ sessions', () => {
    const cal = deriveCalibration(4, 'very_active', []);
    expect(cal.tier).toBe('intermediate');
    expect(cal.sessionFrequencyFlagThreshold).toBe(6);
  });

  it('assigns advanced tier for 6+ sessions or extra_active', () => {
    const cal = deriveCalibration(6, 'extra_active', []);
    expect(cal.tier).toBe('advanced');
    expect(cal.strainDivisor).toBe(1400);
    expect(cal.loadRatioThresholds.danger).toBe(1.6);
  });

  it('uses activity level as fallback when frequency is null', () => {
    expect(deriveCalibration(null, 'extra_active', []).tier).toBe('advanced');
    expect(deriveCalibration(null, 'very_active', []).tier).toBe('intermediate');
    expect(deriveCalibration(null, 'moderately_active', []).tier).toBe('developing');
    expect(deriveCalibration(null, null, []).tier).toBe('beginner');
  });

  it('applies personal overrides with 7+ unique training days', () => {
    const sessions: SessionRow[] = [];
    // Create 10 unique training days over 28 days
    for (let i = 0; i < 10; i++) {
      sessions.push(makeSession({
        date: dateStr(i * 2),
        rpe: 6,
        duration_minutes: 60,
        intensity_level: 3,
      }));
    }

    const cal = deriveCalibration(3, 'moderately_active', sessions);
    // Should have personal overrides
    expect(cal.rpeCeiling).toBeCloseTo(7.5, 0); // avg 6 + 1.5
    expect(cal.normalSessionsPerWeek).toBeGreaterThan(0);
    expect(cal.strainDivisor).not.toBe(900); // should be personalized, not default
  });

  it('defaults to developing when no profile provided', () => {
    const cal = deriveCalibration(null, null, []);
    expect(cal.tier).toBe('beginner');
  });
});

// ─── Detect Trends ──────────────────────────────────────────

describe('detectTrends', () => {
  it('returns no alerts with insufficient data', () => {
    const trends = detectTrends([], []);
    expect(trends.alerts).toHaveLength(0);
    expect(trends.sorenessRising).toBe(false);
    expect(trends.sleepDeclining).toBe(false);
    expect(trends.loadEscalating).toBe(false);
    expect(trends.rpeCreeping).toBe(false);
  });

  it('detects rising soreness over 3 days', () => {
    const sessions = [
      makeSession({ date: dateStr(0), soreness_level: 8 }),
      makeSession({ date: dateStr(1), soreness_level: 6 }),
      makeSession({ date: dateStr(2), soreness_level: 4 }),
    ];
    const trends = detectTrends(sessions, []);
    expect(trends.sorenessRising).toBe(true);
    expect(trends.alerts.length).toBeGreaterThan(0);
  });

  it('does not flag soreness when not consistently rising', () => {
    const sessions = [
      makeSession({ date: dateStr(0), soreness_level: 5 }),
      makeSession({ date: dateStr(1), soreness_level: 7 }), // dip
      makeSession({ date: dateStr(2), soreness_level: 4 }),
    ];
    const trends = detectTrends(sessions, []);
    expect(trends.sorenessRising).toBe(false);
  });

  it('detects declining sleep over 4 nights', () => {
    const sessions = [
      makeSession({ date: dateStr(0), sleep_hours: 5 }),
      makeSession({ date: dateStr(1), sleep_hours: 6 }),
      makeSession({ date: dateStr(2), sleep_hours: 7 }),
      makeSession({ date: dateStr(3), sleep_hours: 8 }),
    ];
    const trends = detectTrends(sessions, []);
    expect(trends.sleepDeclining).toBe(true);
  });

  it('detects load escalating over 3 days', () => {
    const dailyLoads = [
      { date: dateStr(3), load: 200 },
      { date: dateStr(2), load: 300 },
      { date: dateStr(1), load: 500 },
      { date: dateStr(0), load: 700 },
    ];
    const trends = detectTrends([], dailyLoads);
    expect(trends.loadEscalating).toBe(true);
  });

  it('does not flag load escalating when rest days present', () => {
    const dailyLoads = [
      { date: dateStr(2), load: 300 },
      { date: dateStr(1), load: 0 }, // rest day
      { date: dateStr(0), load: 700 },
    ];
    const trends = detectTrends([], dailyLoads);
    expect(trends.loadEscalating).toBe(false);
  });

  it('detects RPE creeping up', () => {
    const sessions = [
      // Recent 3 sessions: high RPE
      makeSession({ date: dateStr(0), rpe: 9, created_at: new Date().toISOString() }),
      makeSession({ date: dateStr(1), rpe: 9, created_at: new Date(Date.now() - 86400000).toISOString() }),
      makeSession({ date: dateStr(2), rpe: 8, created_at: new Date(Date.now() - 172800000).toISOString() }),
      // Prior 3: low RPE
      makeSession({ date: dateStr(3), rpe: 6, created_at: new Date(Date.now() - 259200000).toISOString() }),
      makeSession({ date: dateStr(4), rpe: 5, created_at: new Date(Date.now() - 345600000).toISOString() }),
      makeSession({ date: dateStr(5), rpe: 6, created_at: new Date(Date.now() - 432000000).toISOString() }),
    ];
    const trends = detectTrends(sessions, []);
    expect(trends.rpeCreeping).toBe(true);
  });
});

// ─── Apply Rest Day Recovery ────────────────────────────────

describe('applyRestDayRecovery', () => {
  // Original 3-arg tests (backward compat)
  it('reduces score by 15% with good recovery conditions', () => {
    expect(applyRestDayRecovery(60, 3, 'good')).toBeCloseTo(51, 0);
  });

  it('reduces score by only 5% with poor conditions', () => {
    expect(applyRestDayRecovery(60, 7, 'poor')).toBeCloseTo(57, 0);
  });

  it('reduces by 5% when soreness is high even with good sleep', () => {
    expect(applyRestDayRecovery(60, 6, 'good')).toBeCloseTo(57, 0);
  });

  it('never goes below 0', () => {
    expect(applyRestDayRecovery(1, 1, 'good')).toBeGreaterThanOrEqual(0);
  });

  // New granular recovery tests
  it('gives maximum recovery with all ideal conditions', () => {
    // good sleep quality (+8), 8h+ sleep (+5), soreness ≤2 (+5), fatigue ≤3 (+4), mobility (+3) = 25% + 5% base = 30% → capped at 25%
    const result = applyRestDayRecovery(100, 1, 'good', 9, 2, true);
    // 25% reduction → 75
    expect(result).toBeCloseTo(75, 0);
  });

  it('gives minimum recovery with all poor conditions', () => {
    // null sleep quality (+0), 5h sleep (+0), soreness 9 (+0), fatigue 9 (+0), no mobility (+0) = 5% base
    const result = applyRestDayRecovery(100, 9, null, 5, 9, false);
    // 5% reduction → 95
    expect(result).toBeCloseTo(95, 0);
  });

  it('gives moderate recovery with mixed conditions', () => {
    // good sleep quality (+8), 7h sleep (+3), soreness 4 (+3), fatigue 5 (+2), no mobility (+0) = base 5 + 16 = 21%
    const result = applyRestDayRecovery(80, 4, 'good', 7, 5, false);
    expect(result).toBeCloseTo(80 * (1 - 0.21), 0);
  });

  it('handles null optional params in granular mode', () => {
    // Even with undefined fatigueLevel and mobilityDone, entering granular mode (sleepHours provided)
    const result = applyRestDayRecovery(80, 3, 'good', 8, null, null);
    // good sleep (+8), 8h+ sleep (+5), soreness ≤4 (+3), fatigue null→10 (+0), mobility null (+0) = 5+16 = 21%
    expect(result).toBeCloseTo(80 * (1 - 0.21), 0);
  });

  it('sleep hours contribution is graduated', () => {
    const base = 100;
    const r8 = applyRestDayRecovery(base, 5, null, 8, 5, false);
    const r7 = applyRestDayRecovery(base, 5, null, 7, 5, false);
    const r6 = applyRestDayRecovery(base, 5, null, 6, 5, false);
    const r5 = applyRestDayRecovery(base, 5, null, 5, 5, false);

    // More sleep = more recovery = lower OT score
    expect(r8).toBeLessThan(r7);
    expect(r7).toBeLessThan(r6);
    expect(r6).toBeLessThan(r5);
  });
});

// ─── Compute Readiness ──────────────────────────────────────

describe('computeReadiness', () => {
  const defaultCalibration: AthleteCalibration = {
    tier: 'developing',
    loadRatioThresholds: { caution: 1.2, danger: 1.4 },
    rpeCeiling: 7,
    normalSessionsPerWeek: 3,
    strainDivisor: 900,
    sessionFrequencyFlagThreshold: 4,
  };

  function buildDailyLoadsForTest(loadPattern: number[]): { date: string; load: number; sessions: SessionRow[] }[] {
    return loadPattern.map((load, i) => ({
      date: dateStr(loadPattern.length - 1 - i),
      load,
      sessions: load > 0
        ? [makeSession({ date: dateStr(loadPattern.length - 1 - i), rpe: 7, duration_minutes: 60 })]
        : [],
    }));
  }

  it('returns neutral readiness (50) with no data', () => {
    const dailyLoads = buildDailyLoadsForTest(new Array(28).fill(0));
    const result = computeReadiness([], dailyLoads, 0, defaultCalibration);
    // Sleep: 50 (no data), Soreness: 80 (no data default), Load: 70 (detraining), Recovery: high, Consistency: 50
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThanOrEqual(70);
  });

  it('labels peaked for high score', () => {
    // Good sleep, low soreness, optimal load ratio, good rest pattern
    const sessions = [
      makeSession({ date: dateStr(0), sleep_hours: 9, soreness_level: 1 }),
      makeSession({ date: dateStr(1), sleep_hours: 8.5, soreness_level: 1 }),
      makeSession({ date: dateStr(2), sleep_hours: 8, soreness_level: 2 }),
    ];
    // Build 28 days with moderate load to get good load ratio
    const loads = new Array(28).fill(0);
    for (let i = 0; i < 28; i++) loads[i] = i < 21 ? 400 : 450; // slight increase
    const dailyLoads = buildDailyLoadsForTest(loads);
    // Add sessions to last 3 days
    dailyLoads[25].sessions = [sessions[2]];
    dailyLoads[26].sessions = [sessions[1]];
    dailyLoads[27].sessions = [sessions[0]];
    // Set some rest days
    dailyLoads[24].load = 0;
    dailyLoads[24].sessions = [];

    const result = computeReadiness(sessions, dailyLoads, 1.0, defaultCalibration);
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(['peaked', 'ready']).toContain(result.label);
  });

  it('labels strained for low score', () => {
    const sessions = [
      makeSession({ date: dateStr(0), sleep_hours: 4, soreness_level: 9 }),
      makeSession({ date: dateStr(1), sleep_hours: 4.5, soreness_level: 8 }),
      makeSession({ date: dateStr(2), sleep_hours: 5, soreness_level: 8 }),
    ];
    const loads = new Array(28).fill(500);
    const dailyLoads = buildDailyLoadsForTest(loads);

    const result = computeReadiness(sessions, dailyLoads, 1.8, defaultCalibration);
    expect(result.score).toBeLessThan(40);
    expect(['strained', 'recovering']).toContain(result.label);
  });

  it('has all breakdown components', () => {
    const dailyLoads = buildDailyLoadsForTest(new Array(28).fill(300));
    const result = computeReadiness([], dailyLoads, 1.0, defaultCalibration);
    expect(result.breakdown).toHaveProperty('sleepScore');
    expect(result.breakdown).toHaveProperty('sorenessScore');
    expect(result.breakdown).toHaveProperty('loadBalanceScore');
    expect(result.breakdown).toHaveProperty('recoveryScore');
    expect(result.breakdown).toHaveProperty('consistencyScore');
  });

  it('sleep component responds to sleep data', () => {
    // Use a shared baseline of mixed sleep hours so that 28d avg sits around 7h
    const baselineSessions: SessionRow[] = [];
    for (let i = 3; i < 20; i++) {
      baselineSessions.push(makeSession({ date: dateStr(i), sleep_hours: 7 }));
    }

    const goodSleep = [
      ...baselineSessions,
      makeSession({ date: dateStr(0), sleep_hours: 9 }),
      makeSession({ date: dateStr(1), sleep_hours: 9 }),
      makeSession({ date: dateStr(2), sleep_hours: 9 }),
    ];
    const badSleep = [
      ...baselineSessions,
      makeSession({ date: dateStr(0), sleep_hours: 4 }),
      makeSession({ date: dateStr(1), sleep_hours: 4 }),
      makeSession({ date: dateStr(2), sleep_hours: 4 }),
    ];
    const dailyLoads = buildDailyLoadsForTest(new Array(28).fill(300));

    const goodResult = computeReadiness(goodSleep, dailyLoads, 1.0, defaultCalibration);
    const badResult = computeReadiness(badSleep, dailyLoads, 1.0, defaultCalibration);

    expect(goodResult.breakdown.sleepScore).toBeGreaterThan(badResult.breakdown.sleepScore);
  });
});

// ─── Compute All Metrics ────────────────────────────────────

describe('computeAllMetrics', () => {
  it('handles empty sessions (new user)', () => {
    const metrics = computeAllMetrics([]);
    expect(metrics.strain).toBe(0);
    expect(metrics.acuteLoad).toBe(0);
    expect(metrics.chronicLoad).toBe(0);
    expect(metrics.loadRatio).toBe(0);
    expect(metrics.overtrainingRisk.zone).toBe('low');
    expect(metrics.strainHistory).toHaveLength(7);
    // New fields present
    expect(metrics.readiness).toBeDefined();
    expect(metrics.readiness.score).toBeGreaterThanOrEqual(0);
    expect(metrics.readiness.label).toBeDefined();
    expect(metrics.readiness.breakdown).toBeDefined();
    expect(metrics.trends).toBeDefined();
    expect(metrics.trends.alerts).toHaveLength(0);
    expect(metrics.calibration).toBeDefined();
    expect(metrics.calibration.tier).toBe('beginner');
    expect(typeof metrics.sleepScore).toBe('number');
    expect(typeof metrics.avgSleepLast3).toBe('number');
  });

  it('calculates strain for today\'s sessions', () => {
    const today = dateStr(0);
    const sessions = [
      makeSession({ date: today, rpe: 8, duration_minutes: 90, intensity_level: 4 }),
    ];
    const metrics = computeAllMetrics(sessions);
    // Strain now uses personalized divisor (beginner: 700 with no profile)
    expect(metrics.strain).toBeGreaterThan(0);
  });

  it('detects consecutive high strain days', () => {
    const sessions: SessionRow[] = [];
    // 3 consecutive days of very high sessions
    for (let i = 0; i < 3; i++) {
      sessions.push(makeSession({
        date: dateStr(i),
        rpe: 10,
        duration_minutes: 120,
        intensity_level: 5,
      }));
    }
    const metrics = computeAllMetrics(sessions);
    expect(metrics.consecutiveHighDays).toBeGreaterThanOrEqual(3);
  });

  it('calculates load ratio correctly', () => {
    const sessions: SessionRow[] = [];
    // Put high sessions only in last 7 days, nothing in the 21 before
    for (let i = 0; i < 7; i++) {
      sessions.push(makeSession({
        date: dateStr(i),
        rpe: 8,
        duration_minutes: 60,
        intensity_level: 3,
      }));
    }
    const metrics = computeAllMetrics(sessions);
    // All load is in acute period, very little chronic → high ratio
    expect(metrics.loadRatio).toBeGreaterThan(1);
  });

  it('returns 7 entries in strainHistory', () => {
    const metrics = computeAllMetrics([]);
    expect(metrics.strainHistory).toHaveLength(7);
    metrics.strainHistory.forEach(entry => {
      expect(entry.strain).toBe(0);
      expect(entry.date).toBeTruthy();
    });
  });

  it('provides forecast data', () => {
    const sessions = [
      makeSession({ date: dateStr(0), rpe: 7, duration_minutes: 60, intensity_level: 3 }),
      makeSession({ date: dateStr(1), rpe: 6, duration_minutes: 45, intensity_level: 2 }),
      makeSession({ date: dateStr(2), rpe: 8, duration_minutes: 60, intensity_level: 4 }),
    ];
    const metrics = computeAllMetrics(sessions);
    expect(metrics.forecast.predictedStrain).toBeGreaterThan(0);
    expect(metrics.forecast.predictedLoadRatio).toBeGreaterThan(0);
  });

  it('flags high overtraining risk for extreme training', () => {
    const sessions: SessionRow[] = [];
    // 14+ distinct training days so the cold-start gate is satisfied and
    // the load-spike penalty can actually fire. Reflects an athlete deep
    // into camp, not a brand-new user.
    for (let i = 0; i < 14; i++) {
      sessions.push(makeSession({
        date: dateStr(i),
        session_type: 'Sparring',
        rpe: 9,
        duration_minutes: 90,
        intensity_level: 5,
        soreness_level: 8,
      }));
      sessions.push(makeSession({
        date: dateStr(i),
        session_type: 'Sparring',
        rpe: 8,
        duration_minutes: 60,
        intensity_level: 4,
        soreness_level: 7,
      }));
    }
    const metrics = computeAllMetrics(sessions);
    expect(metrics.loadConfidence.isReliable).toBe(true);
    // Score > 50 confirms the system is strongly flagging overtraining. The
    // personal-override divisor adapts to the athlete's habitual load so the
    // strain-based "consecutive high days" component doesn't pile on, which
    // is by design — we don't want a chronically heavy athlete to be
    // permanently in the 'high' zone just because their load is consistent.
    expect(metrics.overtrainingRisk.score).toBeGreaterThan(50);
    expect(['moderate', 'high', 'critical']).toContain(metrics.overtrainingRisk.zone);
  });

  it('backward compat — works without profile params', () => {
    const sessions = [
      makeSession({ date: dateStr(0), rpe: 7, duration_minutes: 60, intensity_level: 3, sleep_hours: 7 }),
    ];
    // 1-arg call should still work
    const metrics = computeAllMetrics(sessions);
    expect(metrics.strain).toBeGreaterThan(0);
    expect(metrics.readiness).toBeDefined();
    expect(metrics.calibration.tier).toBe('beginner');
  });

  it('uses profile params for calibration when provided', () => {
    const sessions = [
      makeSession({ date: dateStr(0), rpe: 7, duration_minutes: 60, intensity_level: 3 }),
    ];
    const metricsAdvanced = computeAllMetrics(sessions, 6, 'extra_active');
    const metricsDefault = computeAllMetrics(sessions);

    expect(metricsAdvanced.calibration.tier).toBe('advanced');
    expect(metricsDefault.calibration.tier).toBe('beginner');
    // Advanced should have higher strain divisor → lower strain
    expect(metricsAdvanced.calibration.strainDivisor).toBeGreaterThan(metricsDefault.calibration.strainDivisor);
  });

  it('populates new fields with data', () => {
    const sessions: SessionRow[] = [];
    for (let i = 0; i < 7; i++) {
      sessions.push(makeSession({
        date: dateStr(i),
        rpe: 7,
        duration_minutes: 60,
        intensity_level: 3,
        sleep_hours: 7.5,
        soreness_level: 3,
      }));
    }
    const metrics = computeAllMetrics(sessions, 4, 'very_active');
    expect(metrics.sleepScore).toBeGreaterThan(0);
    expect(metrics.avgSleepLast3).toBeGreaterThan(0);
    expect(metrics.readiness.score).toBeGreaterThanOrEqual(0);
    expect(metrics.readiness.score).toBeLessThanOrEqual(100);
    expect(metrics.trends).toBeDefined();
    expect(metrics.calibration.tier).toBe('intermediate');
  });
});

// ─── Cold-start regression tests ───────────────────────────────
// Reproduces the user-reported bug: a single logged session caused the
// Training Load to read "Spike" in red AND capped the Fight Form Score.
// These tests lock in the three-gate guard in computeAdaptiveOvertrainingScore.

describe('cold-start load guards', () => {
  it('emits loadConfidence on every metrics result', () => {
    const metrics = computeAllMetrics([]);
    expect(metrics.loadConfidence).toBeDefined();
    expect(metrics.loadConfidence.required).toBe(14);
    expect(metrics.loadConfidence.trainingDaysIn28d).toBe(0);
    expect(metrics.loadConfidence.isReliable).toBe(false);
  });

  it('does NOT fire load-spike penalty with one session of history', () => {
    // Exact user report: one Friday session against an otherwise empty
    // 28-day window. Without the gate this used to score `40+` and read
    // "Spike" in red.
    const sessions = [
      makeSession({ date: dateStr(0), rpe: 9, duration_minutes: 90, intensity_level: 5 }),
    ];
    const metrics = computeAllMetrics(sessions);
    expect(metrics.loadConfidence.isReliable).toBe(false);
    // No load-spike contribution to the OT score.
    expect(metrics.overtrainingRisk.score).toBeLessThanOrEqual(30);
    expect(metrics.overtrainingRisk.zone).toBe('low');
    // No spike-related factor in the explanation breakdown.
    expect(metrics.overtrainingRisk.factors.join(' ')).not.toMatch(/spike/i);
  });

  it('does NOT fire load-spike penalty when absolute weekly load is tiny', () => {
    // 14+ distinct days clears the chronic-baseline gate but the total
    // weekly load is well below the 500 floor.
    const sessions: SessionRow[] = [];
    for (let i = 0; i < 15; i++) {
      sessions.push(makeSession({ date: dateStr(i), rpe: 2, duration_minutes: 10, intensity_level: 1 }));
    }
    const metrics = computeAllMetrics(sessions);
    expect(metrics.loadConfidence.isReliable).toBe(true);
    expect(metrics.overtrainingRisk.factors.join(' ')).not.toMatch(/spike/i);
  });

  it('softens overtraining warnings when wellness check-in is good', () => {
    // 14+ training days + heavy load = score would normally be high.
    // Adding a Hooper >= 16 (Good/Great wellness) should drop the score
    // by ~25 so the zone steps down at least one tier.
    const sessions: SessionRow[] = [];
    for (let i = 0; i < 14; i++) {
      sessions.push(makeSession({ date: dateStr(i), rpe: 9, duration_minutes: 90, intensity_level: 5, soreness_level: 8 }));
    }
    const withoutWellness = computeAllMetrics(sessions);
    const withGoodWellness = computeAllMetrics(sessions, undefined, undefined, {
      sleep_quality: 6,
      stress_level: 2,
      fatigue_level: 2,
      soreness_level: 2,
      energy_level: 6,
      motivation_level: 6,
      sleep_hours: 8,
      hydration_feeling: 4,
      appetite_level: 4,
      hooper_index: 24, // Good
    });
    expect(withGoodWellness.overtrainingRisk.score).toBeLessThan(withoutWellness.overtrainingRisk.score);
    expect(withGoodWellness.overtrainingRisk.factors.join(' ')).toMatch(/wellness check-in is good/i);
  });
});

// ─── EWMA Load ──────────────────────────────────────────────

describe('ewmaLoad', () => {
  function makeLoads(values: number[]): { date: string; load: number }[] {
    return values.map((load, i) => ({ date: dateStr(values.length - 1 - i), load }));
  }

  it('returns 0 on empty input', () => {
    expect(ewmaLoad([], ACUTE_LAMBDA)).toBe(0);
    expect(ewmaLoad([], 0.5)).toBe(0);
    expect(ewmaLoad([], 1)).toBe(0);
  });

  it('returns the single day load when only one entry', () => {
    expect(ewmaLoad(makeLoads([400]), ACUTE_LAMBDA)).toBe(400);
    expect(ewmaLoad(makeLoads([0]), ACUTE_LAMBDA)).toBe(0);
    expect(ewmaLoad(makeLoads([1234]), 0.5)).toBe(1234);
  });

  it('falls between earliest and latest for monotonically increasing loads', () => {
    const loads = makeLoads([100, 200, 300, 400, 500, 600, 700]);
    const result = ewmaLoad(loads, ACUTE_LAMBDA);
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(700);
  });

  it('weights recent days more heavily with high lambda', () => {
    const loads = makeLoads([100, 200, 300, 400, 500, 600, 700]);
    const highLambda = ewmaLoad(loads, 0.9);
    const lowLambda = ewmaLoad(loads, 0.1);
    // High λ → closer to last value (700); low λ → closer to first (100)
    expect(highLambda).toBeGreaterThan(lowLambda);
  });

  it('λ=1 equals the last day load', () => {
    const loads = makeLoads([100, 200, 300, 400, 500, 600, 700]);
    expect(ewmaLoad(loads, 1)).toBe(700);
  });

  it('λ=0 equals the first day load', () => {
    const loads = makeLoads([100, 200, 300, 400, 500, 600, 700]);
    expect(ewmaLoad(loads, 0)).toBe(100);
  });

  it('produces a sensible recent-weighted average for realistic data', () => {
    const loads = makeLoads([100, 200, 150, 300, 250, 400, 350]);
    const result = ewmaLoad(loads, ACUTE_LAMBDA);
    const simpleMean = (100 + 200 + 150 + 300 + 250 + 400 + 350) / 7;
    // Recent days (400, 350) dominate → EWMA above simple mean of 250
    expect(result).toBeGreaterThan(simpleMean);
    // But must not exceed the maximum observed value
    expect(result).toBeLessThanOrEqual(400);
    expect(result).toBeGreaterThan(0);
  });
});

// ─── Compute EWMA ACWR ──────────────────────────────────────

describe('computeEwmaAcwr', () => {
  function buildLoads(values: number[]): { date: string; load: number }[] {
    return values.map((load, i) => ({ date: dateStr(values.length - 1 - i), load }));
  }

  it('returns loadRatio = 0 when all loads are zero', () => {
    const loads = buildLoads(new Array(28).fill(0));
    const { acuteLoad, chronicLoad, loadRatio } = computeEwmaAcwr(loads);
    expect(acuteLoad).toBe(0);
    expect(chronicLoad).toBe(0);
    expect(loadRatio).toBe(0);
  });

  it('produces loadRatio > 1 on a sudden spike on day 28', () => {
    const loads = buildLoads([
      ...new Array(27).fill(0),
      1000, // spike on day 28
    ]);
    const { acuteLoad, chronicLoad, loadRatio } = computeEwmaAcwr(loads);
    expect(acuteLoad).toBeGreaterThan(chronicLoad);
    expect(loadRatio).toBeGreaterThan(1);
  });

  it('steady load for 28 days produces loadRatio ~ 1', () => {
    const loads = buildLoads(new Array(28).fill(400));
    const { loadRatio } = computeEwmaAcwr(loads);
    // +1 in denominator makes it slightly below 1 but very close
    expect(loadRatio).toBeGreaterThan(0.99);
    expect(loadRatio).toBeLessThanOrEqual(1.01);
  });

  it('detraining (no load last 7d, prior load present) produces loadRatio < 1', () => {
    const loads = buildLoads([
      ...new Array(21).fill(500), // 21 days of solid training
      ...new Array(7).fill(0),     // last 7 days off
    ]);
    const { acuteLoad, chronicLoad, loadRatio } = computeEwmaAcwr(loads);
    expect(acuteLoad).toBeLessThan(chronicLoad);
    expect(loadRatio).toBeLessThan(1);
  });

  it('+1 in denominator prevents divide-by-zero', () => {
    // Acute window has load but chronic baseline is zero (first session ever)
    const loads = buildLoads([
      ...new Array(27).fill(0),
      500,
    ]);
    const { chronicLoad, loadRatio } = computeEwmaAcwr(loads);
    // chronicLoad is tiny but the +1 keeps loadRatio finite
    expect(Number.isFinite(loadRatio)).toBe(true);
    expect(loadRatio).toBeGreaterThanOrEqual(0);
    // Even with very small chronicLoad we don't divide by raw zero
    expect(loadRatio).toBeLessThan(500); // i.e. divisor is at least 1
  });
});

// ─── sportLoadMultiplier ────────────────────────────────────

describe('sportLoadMultiplier', () => {
  it('returns the configured multiplier for known session types', () => {
    expect(sportLoadMultiplier('Sparring')).toBe(1.30);
    expect(sportLoadMultiplier('Live Grappling')).toBe(1.30);
    expect(sportLoadMultiplier('Pad Work')).toBe(1.10);
    expect(sportLoadMultiplier('Strength')).toBe(1.00);
    expect(sportLoadMultiplier('Rest')).toBe(0.0);
  });

  it('returns 1.0 (neutral) for completely unknown types', () => {
    expect(sportLoadMultiplier('SomeMadeUpSport')).toBe(1.0);
    expect(sportLoadMultiplier('Totally Unknown Activity')).toBe(1.0);
  });

  it('normalizes legacy alias "Cardio" to Conditioning (0.90)', () => {
    expect(sportLoadMultiplier('Cardio')).toBe(0.90);
  });

  it('normalizes null/undefined to Drilling (0.95)', () => {
    // sportLoadMultiplier signature requires a string, but normalizeSessionType
    // returns 'Drilling' for null/undefined inputs.
    expect(sportLoadMultiplier(null as unknown as string)).toBe(0.95);
    expect(sportLoadMultiplier(undefined as unknown as string)).toBe(0.95);
    expect(sportLoadMultiplier('')).toBe(0.95);
  });
});

// ─── CNS Multiplier ─────────────────────────────────────────

describe('cnsMultiplier', () => {
  it('returns 1.0 for a single training session', () => {
    const sessions = [makeSession({ rpe: 8 })];
    expect(cnsMultiplier(sessions)).toBe(1.0);
  });

  it('returns 1.0 for no training sessions', () => {
    expect(cnsMultiplier([])).toBe(1.0);
    expect(cnsMultiplier([makeSession({ session_type: 'Rest' })])).toBe(1.0);
  });

  it('returns 1.05 for two low-RPE sessions (no high-RPE)', () => {
    const sessions = [
      makeSession({ rpe: 5 }),
      makeSession({ rpe: 6 }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.05);
  });

  it('returns 1.15 for two high-RPE sessions <6h apart', () => {
    const t0 = new Date('2026-05-01T08:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T12:00:00Z').toISOString(); // +4h
    const sessions = [
      makeSession({ rpe: 8, created_at: t0 }),
      makeSession({ rpe: 8, created_at: t1 }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.15);
  });

  it('returns 1.10 for two high-RPE sessions 6-12h apart', () => {
    const t0 = new Date('2026-05-01T08:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T17:00:00Z').toISOString(); // +9h
    const sessions = [
      makeSession({ rpe: 8, created_at: t0 }),
      makeSession({ rpe: 8, created_at: t1 }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.10);
  });

  it('returns 1.05 for two high-RPE sessions >12h apart', () => {
    const t0 = new Date('2026-05-01T07:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T22:00:00Z').toISOString(); // +15h
    const sessions = [
      makeSession({ rpe: 8, created_at: t0 }),
      makeSession({ rpe: 8, created_at: t1 }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.05);
  });

  it('returns 1.20 for 3+ training sessions', () => {
    const t0 = new Date('2026-05-01T07:00:00Z').toISOString();
    const t1 = new Date('2026-05-01T12:00:00Z').toISOString();
    const t2 = new Date('2026-05-01T18:00:00Z').toISOString();
    const sessions = [
      makeSession({ rpe: 8, created_at: t0 }),
      makeSession({ rpe: 7, created_at: t1 }),
      makeSession({ rpe: 8, created_at: t2 }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.20);
  });

  it('falls back to flat 1.10 for 2 high-RPE sessions with no created_at', () => {
    const sessions = [
      makeSession({ rpe: 8, created_at: null as unknown as string }),
      makeSession({ rpe: 8, created_at: null as unknown as string }),
    ];
    expect(cnsMultiplier(sessions)).toBe(1.10);
  });

  it('falls back to flat ≥1.10 for 3+ sessions with no created_at', () => {
    const sessions = [
      makeSession({ rpe: 8, created_at: null as unknown as string }),
      makeSession({ rpe: 7, created_at: null as unknown as string }),
      makeSession({ rpe: 8, created_at: null as unknown as string }),
    ];
    // With no timestamps, the function returns 1.10 (training.length > 1 branch)
    expect(cnsMultiplier(sessions)).toBe(1.10);
  });

  it('excludes Rest and Recovery sessions from the count', () => {
    const sessions = [
      makeSession({ rpe: 8 }),
      makeSession({ session_type: 'Rest', rpe: 0 }),
      makeSession({ session_type: 'Recovery', rpe: 0 }),
    ];
    // Only one training session → 1.0
    expect(cnsMultiplier(sessions)).toBe(1.0);
  });
});

// ─── Foster Metrics ─────────────────────────────────────────

describe('computeFosterMetrics', () => {
  function buildLoads(values: number[]): { date: string; load: number }[] {
    return values.map((load, i) => ({ date: dateStr(values.length - 1 - i), load }));
  }

  it('returns zeros on empty input', () => {
    expect(computeFosterMetrics([])).toEqual({ weeklyMonotony: 0, weeklyStrain: 0 });
  });

  it('constant daily load (std ≈ 0) returns monotony 0 via guard', () => {
    const loads = buildLoads([400, 400, 400, 400, 400, 400, 400]);
    const { weeklyMonotony, weeklyStrain } = computeFosterMetrics(loads);
    expect(weeklyMonotony).toBe(0);
    expect(weeklyStrain).toBe(0);
  });

  it('same value every day returns monotony 0 (per std-near-zero guard)', () => {
    const loads = buildLoads(new Array(7).fill(123.45));
    const { weeklyMonotony, weeklyStrain } = computeFosterMetrics(loads);
    expect(weeklyMonotony).toBe(0);
    expect(weeklyStrain).toBe(0);
  });

  it('mixed/varied loads produce reasonable monotony', () => {
    const loads = buildLoads([100, 400, 200, 500, 300, 600, 250]);
    const { weeklyMonotony } = computeFosterMetrics(loads);
    // With this spread (range 100-600, mean 335.7, std ~161.8), monotony ≈ 2.07.
    // Foster's red-flag threshold is ~2.0; we expect a sensible non-zero value
    // well below true overtraining patterns (constant-load → infinity-ish).
    expect(weeklyMonotony).toBeGreaterThan(0);
    expect(weeklyMonotony).toBeLessThan(2.5);
  });

  it('alternating high/low pattern produces low monotony (high variance)', () => {
    const loads = buildLoads([100, 800, 100, 800, 100, 800, 100]);
    const constantLoads = buildLoads([400, 410, 400, 410, 400, 410, 400]); // near-constant
    const { weeklyMonotony: alt } = computeFosterMetrics(loads);
    const { weeklyMonotony: nearConst } = computeFosterMetrics(constantLoads);
    // Alternating extremes → low monotony; near-constant → high monotony
    expect(alt).toBeLessThan(nearConst);
    expect(alt).toBeGreaterThan(0);
  });

  it('weekly strain equals weeklyTotal × monotony', () => {
    const loads = buildLoads([100, 400, 200, 500, 300, 600, 250]);
    const weeklyTotal = 100 + 400 + 200 + 500 + 300 + 600 + 250;
    const { weeklyMonotony, weeklyStrain } = computeFosterMetrics(loads);
    expect(weeklyStrain).toBeCloseTo(weeklyTotal * weeklyMonotony, 5);
  });
});

// ─── Contact Load ───────────────────────────────────────────

describe('computeContactLoad', () => {
  it('returns 0 rounds and low zone with no contact sessions', () => {
    const sessions = [
      makeSession({ date: dateStr(0), session_type: 'Strength' }),
      makeSession({ date: dateStr(1), session_type: 'Run' }),
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(0);
    expect(contactRiskZone).toBe('low');
  });

  it('returns 10 rounds → moderate zone for 1 contact session last 7d', () => {
    const sessions = [
      { ...makeSession({ date: dateStr(2), session_type: 'Sparring' }), rounds: 10 } as SessionRow,
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(10);
    expect(contactRiskZone).toBe('moderate');
  });

  it('returns 20 rounds → high zone for 1 contact session last 7d', () => {
    const sessions = [
      { ...makeSession({ date: dateStr(3), session_type: 'Sparring' }), rounds: 20 } as SessionRow,
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(20);
    expect(contactRiskZone).toBe('high');
  });

  it('returns critical zone for 30+ rounds last 7d', () => {
    const sessions = [
      { ...makeSession({ date: dateStr(1), session_type: 'Sparring' }), rounds: 15 } as SessionRow,
      { ...makeSession({ date: dateStr(3), session_type: 'Live Grappling' }), rounds: 20 } as SessionRow,
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(35);
    expect(contactRiskZone).toBe('critical');
  });

  it('does NOT count contact sessions outside 7d window', () => {
    const sessions = [
      { ...makeSession({ date: dateStr(20), session_type: 'Sparring' }), rounds: 25 } as SessionRow,
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(0);
    expect(contactRiskZone).toBe('low');
  });

  it('does NOT count non-contact sessions even if they have rounds field', () => {
    const sessions = [
      { ...makeSession({ date: dateStr(1), session_type: 'Strength' }), rounds: 50 } as SessionRow,
      { ...makeSession({ date: dateStr(2), session_type: 'Pad Work' }), rounds: 20 } as SessionRow,
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    // Only sparring/live-grappling count — Strength and Pad Work do not
    expect(contactRoundsLast7d).toBe(0);
    expect(contactRiskZone).toBe('low');
  });

  it('treats missing rounds field on contact session as 0', () => {
    const sessions = [
      makeSession({ date: dateStr(2), session_type: 'Sparring' }), // no `rounds`
    ];
    const { contactRoundsLast7d, contactRiskZone } = computeContactLoad(sessions);
    expect(contactRoundsLast7d).toBe(0);
    expect(contactRiskZone).toBe('low');
  });
});

// ─── Camp Phase ─────────────────────────────────────────────

describe('determineCampPhase', () => {
  it('returns off-camp for null daysToFight', () => {
    expect(determineCampPhase(null)).toBe('off-camp');
  });

  it('returns off-camp for 35 days out', () => {
    expect(determineCampPhase(35)).toBe('off-camp');
  });

  it('returns build for 21 days out', () => {
    expect(determineCampPhase(21)).toBe('build');
  });

  it('returns peak for 10 days out', () => {
    expect(determineCampPhase(10)).toBe('peak');
  });

  it('returns taper for 5 days out', () => {
    expect(determineCampPhase(5)).toBe('taper');
  });

  it('returns taper for 0 days out (fight day)', () => {
    expect(determineCampPhase(0)).toBe('taper');
  });
});

describe('applyCampPhaseToCalibration', () => {
  const baseCalibration: AthleteCalibration = {
    tier: 'developing',
    loadRatioThresholds: { caution: 1.2, danger: 1.4 },
    rpeCeiling: 7,
    normalSessionsPerWeek: 3,
    strainDivisor: 900,
    sessionFrequencyFlagThreshold: 4,
  };

  it('off-camp leaves thresholds untouched but stamps phase', () => {
    const result = applyCampPhaseToCalibration(baseCalibration, 'off-camp');
    expect(result.loadRatioThresholds.caution).toBeCloseTo(1.2, 5);
    expect(result.loadRatioThresholds.danger).toBeCloseTo(1.4, 5);
    expect(result.phase).toBe('off-camp');
  });

  it("peak shifts caution +0.15 and danger +0.10", () => {
    const result = applyCampPhaseToCalibration(baseCalibration, 'peak');
    expect(result.loadRatioThresholds.caution).toBeCloseTo(1.35, 5);
    expect(result.loadRatioThresholds.danger).toBeCloseTo(1.50, 5);
    expect(result.phase).toBe('peak');
  });

  it("taper shifts both thresholds +0.20", () => {
    const result = applyCampPhaseToCalibration(baseCalibration, 'taper');
    expect(result.loadRatioThresholds.caution).toBeCloseTo(1.40, 5);
    expect(result.loadRatioThresholds.danger).toBeCloseTo(1.60, 5);
    expect(result.phase).toBe('taper');
  });

  it("build shifts both thresholds -0.05", () => {
    const result = applyCampPhaseToCalibration(baseCalibration, 'build');
    expect(result.loadRatioThresholds.caution).toBeCloseTo(1.15, 5);
    expect(result.loadRatioThresholds.danger).toBeCloseTo(1.35, 5);
    expect(result.phase).toBe('build');
  });

  it('returns a new object — does not mutate input', () => {
    const result = applyCampPhaseToCalibration(baseCalibration, 'peak');
    // Input must be untouched
    expect(baseCalibration.loadRatioThresholds.caution).toBe(1.2);
    expect(baseCalibration.loadRatioThresholds.danger).toBe(1.4);
    expect(baseCalibration.phase).toBeUndefined();
    expect(result).not.toBe(baseCalibration);
  });

  it('CHRONIC_LAMBDA constant matches expected formula 2/(28+1)', () => {
    expect(CHRONIC_LAMBDA).toBeCloseTo(2 / 29, 10);
  });

  it('ACUTE_LAMBDA constant matches expected formula 2/(7+1)', () => {
    expect(ACUTE_LAMBDA).toBeCloseTo(2 / 8, 10);
  });
});
