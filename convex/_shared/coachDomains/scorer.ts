/* ------------------------------------------------------------------ */
/* Tier-1 deterministic intent router for the Fight Camp Coach.         */
/* Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md */
/*                                                                     */
/* Hybrid routing = keyword scorer (this file, fast/deterministic) +   */
/* an LLM arbiter (elsewhere). `scoreDomains` is the cheap first pass;  */
/* `selectDomains` fuses keyword + arbiter hits into the final, capped  */
/* card list. Pure functions only — no ctx, no I/O, no randomness.     */
/* ------------------------------------------------------------------ */

import type { DomainId } from "../aiSchemas";

/**
 * Keyword / phrase regexes per domain. A message "matches" a domain if
 * ANY of its regexes hit. Some words intentionally appear in multiple
 * domains (e.g. "tired" → recovery + sleep, "readiness" → recovery +
 * fight_score, "on track" → weight + fight_score) — that's expected;
 * the arbiter disambiguates and `scoreDomains` ranks by match count.
 */
export const DOMAIN_KEYWORDS: Record<DomainId, RegExp[]> = {
  // Scale / weight-cut progress against target.
  weight: [
    /\bweight\b|\bweigh\b|\bscale\b/i,
    /\b\d+(\.\d+)?\s?(kg|lbs?|pounds?)\b|\bkilos?\b/i,
    /\bcut(ting)?\b|\bdrop\b|\blos(e|ing)\b|\bshed\b|\bheavy\b|\bover\b/i,
    /\bon track\b|\btarget weight\b|\bmaking weight\b/i,
  ],

  // The structured fight-week protocol (water/sodium load, rehydrate…).
  fight_week: [
    /\bfight ?week\b|\bweigh.?ins?\b|\bday before\b/i,
    /\bwater load(ing)?\b|\bsodium\b|\bcarb load\b/i,
    /\brehydrat|refuel|peak(ing)?\b/i,
    /\bcut plan\b|\bprotocol\b/i,
  ],

  // Training volume / intensity / sessions.
  training_load: [
    /\btrain(ing)?\b|\bsession\b|\bworkout\b|\bload\b|\bvolume\b/i,
    /\bspar(ring)?\b|\brolls?\b|\bgrappl|\bdrill(ed|ing)?\b|\brounds?\b/i,
    /\bstrength\b|\bs&c\b|\bconditioning\b|\bcardio\b/i,
    /\bhard week\b|\bovertrain|\btoo much\b|\bgym\b/i,
    // Technique / skill focus — what they drilled or are working on/struggling
    // with. Routes "how's my southpaw", "what should I work on", "keep getting
    // countered" to the training notes now carried in this domain.
    /\btechniques?\b|\bcombo(s|nation)?\b|\bwork(ing)? on\b|\bimprove\b|\bstruggl|\bgetting countered\b|\bcan'?t (land|finish|get)\b/i,
  ],

  // Diet / food intake / macros.
  nutrition: [
    /\beat(ing|en)?\b|\bate\b|\bfood\b|\bmeal\b|\bdiet\b|\bsnack\b/i,
    /\bcalor|\bkcal\b|\bmacros?\b|\bprotein\b|\bcarbs?\b|\bfats?\b/i,
    /\bnutrition\b|\bhungry\b/i,
    /\bbreakfast\b|\blunch\b|\bdinner\b/i,
  ],

  // Overall readiness / "how am I doing" / limiters.
  fight_score: [
    /\bfight ?form\b|\bscore\b|\blimiter\b/i,
    /\breadiness\b|\bready\b/i,
    /\bhow am i doing\b|\bam i (on track|ready)\b/i,
    /\bon track\b/i,
  ],

  // Physiological recovery markers / fatigue.
  recovery: [
    /\brecover(y|ed|ing)?\b|\bhrv\b|\bresting heart\b|\brhr\b/i,
    /\bsore\b|\bfatigue(d)?\b|\bdrained\b|\bgassed\b|\bburn(t|ed) out\b/i,
    /\bstress(ed)?\b|\breadiness\b/i,
    /\btired\b|\bexhaust|\bwiped\b/i,
  ],

  // Sleep quantity / quality.
  sleep: [
    /\bsleep\b|\bslept\b|\bnap\b|\binsomnia\b/i,
    /\bbed\b|\bhours of sleep\b|\bwoke\b|\brest(ed|less)?\b/i,
    /\btired\b/i,
  ],
};

/**
 * Canonical priority order used to break ties when ranking. Domains the
 * user most directly asks about (fight_score "how am I doing", weight
 * progress, fight-week protocol) sit ahead of contextual support
 * domains. Used as a stable secondary sort key.
 *
 * @example listed order: weight is the camp spine, sleep is most niche.
 */
const PRIORITY_ORDER: DomainId[] = [
  "fight_score",
  "fight_week",
  "weight",
  "training_load",
  "nutrition",
  "recovery",
  "sleep",
];

const priorityIndex = (d: DomainId): number => {
  const i = PRIORITY_ORDER.indexOf(d);
  return i === -1 ? PRIORITY_ORDER.length : i;
};

/** Domains whose presence implies the user is in fight-week territory. */
const FIGHT_WEEK_TRIGGERS: readonly DomainId[] = ["fight_week"];

/**
 * Tier-1 keyword scorer. Returns every DomainId with at least one
 * regex match, ordered by match strength (distinct regexes hit, desc),
 * with PRIORITY_ORDER as a deterministic tie-break. Empty if no match.
 *
 * @example scoreDomains("how's my weight, am I on track?")
 *   → ["weight", "fight_score"]  // weight has more distinct hits
 * @example scoreDomains("hi") → []
 */
export function scoreDomains(message: string): DomainId[] {
  const text = message ?? "";
  const scored: { id: DomainId; hits: number }[] = [];

  for (const id of PRIORITY_ORDER) {
    const regexes = DOMAIN_KEYWORDS[id];
    let hits = 0;
    for (const re of regexes) {
      if (re.test(text)) hits += 1;
    }
    if (hits > 0) scored.push({ id, hits });
  }

  scored.sort((a, b) =>
    b.hits !== a.hits ? b.hits - a.hits : priorityIndex(a.id) - priorityIndex(b.id),
  );

  return scored.map((s) => s.id);
}

/**
 * Fuse the keyword pass and the LLM arbiter into the final card list.
 *
 * Capping / priority rule:
 *   1. Union keywordHits ∪ arbiterHits, deduped. A domain that BOTH
 *      passes agree on is treated as directly-asked and ranked first;
 *      domains from a single source rank below, ordered by PRIORITY_ORDER.
 *   2. If `hasActiveCamp`, the camp spine (weight, plus fight_week when
 *      the turn is fight-week-ish) is appended as a LOW-priority fallback
 *      so there is always at least one card — but it never displaces a
 *      directly-asked domain. If the user only asked about an unrelated
 *      domain, the spine simply fills any remaining slot(s).
 *   3. Cap to `max ?? 3`, keeping highest priority first.
 *
 * Deterministic and pure.
 *
 * @example user asks only about sleep, active camp →
 *   ["sleep", "weight"]  // sleep directly-asked, weight as spine fallback
 */
export function selectDomains(opts: {
  keywordHits: DomainId[];
  arbiterHits: DomainId[];
  hasActiveCamp: boolean;
  max?: number;
}): DomainId[] {
  const { keywordHits, arbiterHits, hasActiveCamp } = opts;
  const max = opts.max ?? 3;

  const kw = new Set(keywordHits);
  const arb = new Set(arbiterHits);

  // Tier A: agreed by both passes (strongest signal of direct intent).
  const agreed = keywordHits.filter((d) => arb.has(d));
  // Tier B: requested by exactly one pass.
  const single = [...keywordHits, ...arbiterHits].filter(
    (d) => !(kw.has(d) && arb.has(d)),
  );

  // Build the directly-asked ranking: agreed first, then singles, deduped,
  // each tier ordered by PRIORITY_ORDER for determinism.
  const directlyAsked: DomainId[] = [];
  const seen = new Set<DomainId>();
  for (const tier of [agreed, single]) {
    const ordered = [...new Set(tier)].sort(
      (a, b) => priorityIndex(a) - priorityIndex(b),
    );
    for (const d of ordered) {
      if (!seen.has(d)) {
        seen.add(d);
        directlyAsked.push(d);
      }
    }
  }

  // Tier C: camp spine fallback — low priority, only fills remaining slots.
  const result = [...directlyAsked];
  if (hasActiveCamp) {
    const fightWeekIsh =
      directlyAsked.some((d) => FIGHT_WEEK_TRIGGERS.includes(d)) ||
      kw.has("fight_week") ||
      arb.has("fight_week");

    const spine: DomainId[] = fightWeekIsh ? ["weight", "fight_week"] : ["weight"];
    for (const d of spine) {
      if (!seen.has(d)) {
        seen.add(d);
        result.push(d);
      }
    }
  }

  return result.slice(0, max);
}
