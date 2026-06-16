/**
 * On-demand AI coaching for the FightForm score sheet.
 *
 * The sheet computes every number deterministically and passes it to the
 * `fightFormCoach` action, which returns prose only ({ summary, actions }).
 * This hook adds:
 *   - a once-per-day-per-score localStorage cache via AIPersistence (key
 *     includes the local date + rounded score, 24h TTL) so re-opening the
 *     sheet on the same day doesn't burn a second LLM call;
 *   - the Pro signal (`isPro`) so the UI can show an upsell instead of calling
 *     the gated action for free users;
 *   - loading / error state around the call.
 */
import { useCallback, useState } from "react";
import { api } from "@/../convex/_generated/api";
import { useAIAction } from "@/hooks/useAIAction";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { AIPersistence } from "@/lib/aiPersistence";
import { logger } from "@/lib/logger";

/** Deterministic context the sheet computes and passes in. Mirrors the
 *  `fightFormCoach.run` action args exactly. */
export interface FightFormCoachContext {
  score: number;
  label: string;
  phase: string | null;
  daysToFight: number | null;
  pillars: Array<{
    key: string;
    label: string;
    value: number;
    weightPct: number;
    contributionPts: number;
    reason: string;
  }>;
  topDriver: string | null;
  topLimiter: string | null;
  ceilings?: Array<{ ruleId: string; cap: number }>;
}

/** Prose-only coaching the action returns. */
export interface FightFormCoaching {
  summary: string;
  actions: Array<{ pillar: string; action: string }>;
}

/** AIPersistence `type` namespace for this feature's cache entries. */
const CACHE_TYPE = "fightform-coach";

/** Local YYYY-MM-DD so the cache rolls over once per local day. */
function localDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** One call per day per (rounded) score: re-opening the sheet at the same
 *  score on the same day hits the cache; a meaningfully different score
 *  earns a fresh read. */
function cacheKey(score: number): string {
  return `${CACHE_TYPE}_${localDateKey()}_${Math.round(score)}`;
}

interface UseFightFormCoach {
  coaching: FightFormCoaching | null;
  loading: boolean;
  error: string | null;
  isPro: boolean;
  generate: (context: FightFormCoachContext) => Promise<void>;
}

export function useFightFormCoach(): UseFightFormCoach {
  const { userId } = useUser();
  const { isPremium } = useSubscription();
  const coachAction = useAIAction(
    api.actions.fightFormCoach.run,
    "AI_FIGHT_CAMP_COACH",
  );

  const [coaching, setCoaching] = useState<FightFormCoaching | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (context: FightFormCoachContext) => {
      if (!userId || loading) return;

      // Cache check — one call/day per score. AIPersistence handles TTL expiry.
      const key = cacheKey(context.score);
      const cached = AIPersistence.load(userId, key) as FightFormCoaching | null;
      if (cached && typeof cached.summary === "string") {
        setCoaching(cached);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const result = (await coachAction(context)) as FightFormCoaching;
        setCoaching(result);
        AIPersistence.save(userId, key, result, 24);
      } catch (err) {
        logger.error("FightForm Coach generate failed", err);
        setError(
          err instanceof Error ? err.message : "Failed to reach the coach",
        );
      } finally {
        setLoading(false);
      }
    },
    [userId, loading, coachAction],
  );

  return { coaching, loading, error, isPro: isPremium, generate };
}
