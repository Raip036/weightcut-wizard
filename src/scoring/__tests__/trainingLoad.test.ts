import { describe, it, expect } from "vitest";
import { computeTrainingLoad } from "../subScores/trainingLoad";
import { ScoringConfigV1 } from "../config/v1";

const cfg = ScoringConfigV1;

function sess(date: string, rpe: number, mins: number) {
  return { date, rpe, durationMinutes: mins };
}

describe("computeTrainingLoad", () => {
  it("returns 100 when ACWR is in the sweet spot (1.0)", () => {
    const sessions = [];
    // 28 days of consistent 100 load: 1 session/day at rpe=10, 10min
    for (let i = 0; i < 28; i++) {
      const d = new Date("2026-05-01");
      d.setDate(d.getDate() - i);
      sessions.push(sess(d.toISOString().slice(0, 10), 10, 10));
    }
    const r = computeTrainingLoad(sessions, "2026-05-01", cfg);
    expect(r.value).toBe(100);
  });

  it("penalises ACWR < 0.8 (underloading)", () => {
    // recent acute window is low, chronic window is high → ACWR < 0.8
    const sessions = [];
    for (let i = 8; i < 28; i++) {
      const d = new Date("2026-05-01");
      d.setDate(d.getDate() - i);
      sessions.push(sess(d.toISOString().slice(0, 10), 10, 20));
    }
    const r = computeTrainingLoad(sessions, "2026-05-01", cfg);
    expect(r.value).toBeLessThan(100);
    expect(r.value).toBeGreaterThanOrEqual(cfg.trainingLoad.acwrFloor);
  });

  it("returns floor when ACWR > 1.5 (training spike)", () => {
    const sessions = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date("2026-05-01");
      d.setDate(d.getDate() - i);
      sessions.push(sess(d.toISOString().slice(0, 10), 10, 60)); // huge acute load
    }
    // no chronic load → ACWR will be max
    const r = computeTrainingLoad(sessions, "2026-05-01", cfg);
    expect(r.value).toBeLessThanOrEqual(50);
  });

  it("uses available window for cold-start without crashing", () => {
    const sessions = [sess("2026-05-01", 7, 30)];
    const r = computeTrainingLoad(sessions, "2026-05-01", cfg);
    expect(r.value).toBeGreaterThanOrEqual(0);
    expect(r.value).toBeLessThanOrEqual(100);
    expect(r.reason).toMatch(/cold.start|limited/i);
  });

  describe("Fix #5 — EWMA direction sanity (today weighs heaviest)", () => {
    it("recent acute spike + low chronic baseline → ACWR > 1 (today dominates the acute window)", () => {
      // 28 days of low-load training (RPE 4, 30 min) + a recent 3-day spike
      // (RPE 10, 60 min). If EWMA seeded the wrong end, the spike would be
      // discounted and ACWR would stay flat. Correct EWMA: today's spike
      // dominates the 7-day acute mean.
      const sessions = [];
      // Background load: 28 days starting 4 weeks back.
      for (let i = 3; i < 28; i++) {
        const d = new Date("2026-05-01");
        d.setDate(d.getDate() - i);
        sessions.push(sess(d.toISOString().slice(0, 10), 4, 30));
      }
      // Recent spike in last 3 days.
      for (let i = 0; i < 3; i++) {
        const d = new Date("2026-05-01");
        d.setDate(d.getDate() - i);
        sessions.push(sess(d.toISOString().slice(0, 10), 10, 60));
      }
      const r = computeTrainingLoad(sessions, "2026-05-01", cfg);
      // Spike must register: reason mentions an ACWR > 1.
      const m = r.reason.match(/ACWR ([\d.]+)/);
      expect(m).toBeTruthy();
      const acwr = parseFloat(m![1]);
      expect(acwr).toBeGreaterThan(1.0);
    });
  });
});
