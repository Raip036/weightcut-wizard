/**
 * Free daily nudge query (Phase 4, "free daily nudge").
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §5 Phase 4 ("Free daily nudge").
 *
 * The ONE proactive line a FREE user gets each day — the "taste" of the coach
 * before the paywall. It is read-only, deterministic (no LLM), and has NO Pro
 * gate: this is the free surface. The Pro gate stays on the chat action
 * (`fightCampCoach.run`) and the richer briefing/cockpit cards.
 *
 * Reuse: rather than re-deriving the read, this query delegates to
 * `coachBriefing.getBriefing` via `ctx.runQuery`. That query already computes
 * greeting / priorityAction / redFlag deterministically from the user's real
 * camp + weight data, so the nudge can never disagree with the briefing card
 * or the chat. We then pick the single highest-signal line using the SAME
 * precedence as the coach speech bubble: redFlag → priorityAction → greeting.
 *
 * Degrades gracefully: when unauthenticated or when there is no camp, the
 * underlying briefing returns all-null, so `text`/`headline` are null and
 * `hasCamp` is false. `dateKey` is the server's today (YYYY-MM-DD) so the
 * client can enforce a strict 1-per-day surface regardless of device clock.
 */
import { query } from "./_generated/server";
import { api } from "./_generated/api";

// ── Public return shape (the client imports this with `import type`) ───────

export interface DailyNudge {
  text: string | null; // one proactive line from the user's real data
  headline: string | null; // optional short label e.g. "Today's read"
  dateKey: string; // YYYY-MM-DD server date so the client can enforce 1/day
  hasCamp: boolean;
}

// ── Small pure helper ──────────────────────────────────────────────────────

const todayIso = (): string => new Date().toISOString().slice(0, 10);

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * `api.coachNudge.getDailyNudge` — the free daily nudge read.
 *
 * Stays a query (db reads only) by delegating to `coachBriefing.getBriefing`,
 * which already mirrors the cockpit data access. We only choose which derived
 * line to surface and label it.
 */
export const getDailyNudge = query({
  args: {},
  handler: async (ctx): Promise<DailyNudge> => {
    const dateKey = todayIso();

    // Reuse the briefing derivation verbatim (greeting / priorityAction /
    // redFlag are all computed there from the user's real data). This also
    // handles auth + no-camp gracefully (returns all-null).
    const briefing = await ctx.runQuery(api.coachBriefing.getBriefing, {});

    // No camp (or unauthenticated) → the whole briefing is null. The clearest
    // signal that there's a camp is a resolved phase / weigh-in countdown.
    const hasCamp =
      briefing.phase !== null || briefing.daysToWeighIn !== null;

    if (!hasCamp) {
      return { text: null, headline: null, dateKey, hasCamp: false };
    }

    // Same precedence as the coach speech bubble: a safety red flag is the
    // loudest, then the ONE thing to do today, then the greeting read.
    if (briefing.redFlag) {
      return {
        text: briefing.redFlag,
        headline: "Heads up",
        dateKey,
        hasCamp: true,
      };
    }
    if (briefing.priorityAction) {
      return {
        text: briefing.priorityAction,
        headline: "Today's focus",
        dateKey,
        hasCamp: true,
      };
    }
    if (briefing.greeting) {
      return {
        text: briefing.greeting,
        headline: "Today's read",
        dateKey,
        hasCamp: true,
      };
    }

    // Camp exists but nothing derivable yet (rare) — no nudge today.
    return { text: null, headline: null, dateKey, hasCamp: true };
  },
});
