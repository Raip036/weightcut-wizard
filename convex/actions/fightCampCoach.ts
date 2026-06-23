/**
 * Fight Camp Coach — Pro-only structured cornerman (Phase 1 redesign).
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 *       §3.1, §4, §5 Phase 1, §7.
 *
 * Returns a structured `CoachMessage` ({ reply, blocks, followups }) instead
 * of a markdown blob. Numbers in weight_target / chart / metric_row are
 * computed DETERMINISTICALLY server-side (see _shared/coachBlocks.ts) and
 * merged in — the LLM only writes prose + narrative blocks (checklist /
 * callout / timeline / action) and can never hallucinate a figure.
 *
 * Flow (per spec §3.1):
 *   1. auth + Pro gate; load fightWeekData + athlete snapshot
 *   2. compute deterministic blocks (weight_target, chart, metric_row)
 *   3. deterministic safety pre-check → danger callout (always, never gated)
 *   4. intent gate: casual → llama-3.1-8b-instant prose-only;
 *                   planny → gpt-oss-120b JSON-mode via callGroqWithRetry
 *   5. merge server + LLM blocks (server numbers win); return CoachMessage
 *   FALLBACK: structured call throws → one callGroqText plain markdown call
 *             → { reply: <markdown>, blocks: [] }
 *
 * Mirrors generateCutPlan's discipline: compute numbers in code, ban
 * paragraphs + em-dashes in the prompt, validate with Zod, fail soft.
 */
"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { callGroqText, callGroqWithRetry } from "../_shared/groq";
import {
  CoachMessageSchema,
  DomainSelectionSchema,
  type CoachBlock,
  type CoachMessage,
  type DomainId,
} from "../_shared/aiSchemas";
import {
  computeDeterministicBundle,
  classifyIntent,
  buildDomainOutputs,
  mergeDomainBlocks,
  asksAboutCampHistory,
  asksAboutFightWeek,
  SPINE_DOMAINS,
  type CoachFightWeekData,
} from "../_shared/coachBlocks";
import { evaluateSafety, summarizeSafety } from "../_shared/coachSafety";
import {
  buildFightWeekCornermanCards,
  summarizeFightWeekCornerman,
} from "../_shared/coachDomains/fightWeekCornerman";
import {
  buildCampHistoryCards,
  summarizeCampHistory,
} from "../_shared/coachCampHistory";
import {
  buildCampArchitectCards,
  summarizeCampArchitect,
} from "../_shared/coachDomains/campArchitect";
import { scoreDomains, selectDomains } from "../_shared/coachDomains/scorer";
import {
  sanitizeUserText,
  PROMPT_INJECTION_GUARD_INSTRUCTION,
} from "../_shared/sanitizeUserText";
import {
  loadAthleteSnapshot,
  requireUserIdFromAction,
  SECOND_PERSON_DIRECTIVE,
} from "./_helpers";
import { enforceFeatureGate } from "../_shared/featureGates";

const PLANNY_MODEL = "openai/gpt-oss-120b";
const CASUAL_MODEL = "llama-3.1-8b-instant";
/** Cheap arbiter that disambiguates which data domains a turn is about. */
const ARBITER_MODEL = "llama-3.1-8b-instant";
/** All domains the arbiter may choose from (mirrors DomainIdSchema). */
const ALL_DOMAINS: readonly DomainId[] = [
  "weight",
  "fight_week",
  "training_load",
  "nutrition",
  "fight_score",
  "recovery",
  "sleep",
];

export const run = action({
  args: {
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      }),
    ),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, { messages, userName }): Promise<CoachMessage> => {
    const userId = await requireUserIdFromAction(ctx);
    await enforceFeatureGate(ctx, userId, "AI_FIGHT_CAMP_COACH");

    const fightWeek = (await ctx.runQuery(
      internal.actions_internal.fetchFightWeekData,
      { userId },
    )) as CoachFightWeekData;
    const snap = await loadAthleteSnapshot(ctx, userId);

    // ── 2: deterministic weight/fight-week numeric spine ────────────────
    const bundle = computeDeterministicBundle(fightWeek);
    const hasActiveCamp = fightWeek.upcomingCamp != null;

    // ── 3: FULL safety guardrail (Phase 3) — ALWAYS, free, never gated ───
    const safetyInput = await ctx.runQuery(
      internal.coachSafety_internal.getSafetyInput,
      { userId },
    );
    const safety = evaluateSafety(safetyInput);
    const safetyCallout = safety.callout;

    // ── Prep messages: sanitize user turns, cap history ─────────────────
    const capped = messages.slice(-16);
    const safe = capped.map((m) =>
      m.role === "user"
        ? {
            role: m.role,
            content: sanitizeUserText(m.content, { maxLength: 2000, raw: true }),
          }
        : { role: m.role, content: m.content },
    );
    const latestUser = [...safe].reverse().find((m) => m.role === "user");
    const athleteName = userName
      ? sanitizeUserText(userName, { maxLength: 80, raw: true })
      : null;

    // ── 4: intent gate ──────────────────────────────────────────────────
    const intent = classifyIntent(latestUser?.content);

    // ── Phase-3: daily fight-week cornerman + cross-camp memory ──────────
    // Cornerman: load when in fight week (loader gates on hasPlan) OR the user
    // explicitly asked about fight week / weigh-in. Skip cleanly otherwise.
    const wantsFightWeek =
      hasActiveCamp || asksAboutFightWeek(latestUser?.content);
    const cornerman = wantsFightWeek
      ? await ctx.runQuery(
          internal.coachFightWeek_internal.getFightWeekCornerman,
          { userId },
        )
      : null;
    const cornermanCards =
      cornerman && cornerman.hasPlan
        ? buildFightWeekCornermanCards(cornerman)
        : [];
    const cornermanSummary =
      cornerman && cornerman.hasPlan
        ? summarizeFightWeekCornerman(cornerman)
        : "";

    // Camp history: ALWAYS load (cheap) for the prompt summary; only attach the
    // CARD when the user asks about past/history/rebound/comparison.
    const campHistory = await ctx.runQuery(
      internal.coachCampHistory_internal.getCampHistory,
      { userId },
    );
    const campHistorySummary = summarizeCampHistory(campHistory);
    const campHistoryCards = asksAboutCampHistory(latestUser?.content)
      ? buildCampHistoryCards(campHistory)
      : [];

    // ── Phase-4: OFF-SEASON Camp Architect ───────────────────────────────
    // When there is NO active/upcoming camp, the coach flips from cutting to
    // planning: load the architect slice, build its cards (the PRIMARY cards
    // this turn), and inject its summary into the prompt facts. When a camp
    // IS active we skip the loader entirely (existing behavior unchanged).
    // The loader also returns `hasUpcomingCamp` as a defensive double-check;
    // both builders are no-ops if that flips true under us.
    const architect = hasActiveCamp
      ? null
      : await ctx.runQuery(internal.coachArchitect_internal.getArchitectData, {
          userId,
        });
    const architectCards = architect ? buildCampArchitectCards(architect) : [];
    const architectSummary = architect ? summarizeCampArchitect(architect) : "";

    // ── Hybrid domain routing: keyword scorer + (conditional) LLM arbiter ─
    const keywordHits = scoreDomains(latestUser?.content ?? "");
    const arbiterHits = await runArbiter(latestUser?.content, keywordHits);
    const selected = selectDomains({
      keywordHits,
      arbiterHits,
      hasActiveCamp,
      max: 3,
    });

    // ── Load + build domain cards for selected NON-SPINE domains ─────────
    // The loader lazy-fills only non-spine slices, so passing the full list
    // is safe; spine domains (weight/fight_week) come from `bundle` above.
    const domainBundle = await ctx.runQuery(
      internal.coachDomains_internal.getDomainData,
      { userId, domains: selected },
    );
    const { cards: domainCards, summaries: domainSummaries } =
      buildDomainOutputs(selected, domainBundle);

    // ── Weight/fight-week spine: include the deterministic numeric blocks
    //    only when the selection actually contains a spine domain. The safety
    //    callout is independent and always included regardless. ─────────────
    const spineSelected = selected.some((d) => SPINE_DOMAINS.has(d));
    const spineBlocks: CoachBlock[] = spineSelected ? bundle.blocks : [];

    const systemPrompt = buildSystemPrompt({
      athleteName,
      facts: bundle.facts,
      snapshotBlock: snap.block,
      intent,
      domainSummaries,
      safetySummary: summarizeSafety(safetyInput),
      cornermanSummary,
      campHistorySummary,
      architectSummary,
      offSeason: !hasActiveCamp,
    });

    // ── 5: structured call → merge → CoachMessage ───────────────────────
    try {
      const ai = await callGroqWithRetry({
        model: intent === "planny" ? PLANNY_MODEL : CASUAL_MODEL,
        messages: [{ role: "system", content: systemPrompt }, ...safe],
        temperature: 0.5,
        max_tokens: intent === "planny" ? 800 : 400,
        response_format: { type: "json_object" },
        // Numbers are server-computed; the model only writes narrative, so
        // low reasoning keeps quality while cutting latency (same as
        // generateCutPlan). Fail fast to the markdown fallback below.
        reasoning_effort: "low",
        timeoutMs: 12000,
        maxRetries: 2,
        schema: CoachMessageSchema,
      });

      // Merge by priority: safety → cornerman → directly-asked domain cards →
      // weight spine → camp-history → LLM narrative. Server-owned numeric types
      // in the LLM set are dropped; duplicates removed; capped at 6
      // (CoachMessageSchema limit). Safety can never be trimmed.
      const merged = mergeDomainBlocks({
        safetyCallout,
        cornermanCards,
        architectCards,
        domainCards,
        spineBlocks,
        campHistoryCards,
        llmBlocks: filterValidBlocks(ai.blocks),
        max: 6,
      });

      return {
        reply: ai.reply,
        blocks: merged,
        ...(ai.followups && ai.followups.length > 0
          ? { followups: ai.followups }
          : {}),
      };
    } catch (err) {
      console.warn(
        `[fightCampCoach] structured call failed, markdown fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallbackMarkdown({
        systemPrompt,
        messages: safe,
        intent,
        safetyCallout,
        cornermanCards,
        architectCards,
        domainCards,
        spineBlocks,
        campHistoryCards,
      });
    }
  },
});

// ── Domain arbiter (cheap, conditional) ─────────────────────────────────────

/**
 * Decide whether the cheap LLM arbiter is needed and, if so, call it.
 *
 * Fast path (SKIP the arbiter, return []): the keyword scorer already gave a
 * confident, single-dominant result — exactly one hit, OR a clear leader (the
 * keyword list is ranked, so the first id is dominant when there are 1–2 hits).
 *
 * Arbiter path (ONE cheap call): the keyword result is weak or ambiguous —
 * zero hits, or more than two hits (no obvious focus). The arbiter (a tiny
 * JSON-mode `llama-3.1-8b-instant` call) picks ≤3 relevant domains from the
 * fixed list. On any failure it falls back to keyword-only (returns []).
 */
async function runArbiter(
  latestMessage: string | undefined,
  keywordHits: DomainId[],
): Promise<DomainId[]> {
  const text = (latestMessage ?? "").trim();
  if (!text) return [];

  // Fast path: a confident keyword result (1 or 2 hits → first is dominant).
  if (keywordHits.length >= 1 && keywordHits.length <= 2) return [];

  // Ambiguous (0 hits) or noisy (>2 hits): ask the arbiter.
  try {
    const result = await callGroqWithRetry({
      model: ARBITER_MODEL,
      messages: [
        { role: "system", content: ARBITER_SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 600) },
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
      timeoutMs: 6000,
      maxRetries: 1,
      schema: DomainSelectionSchema,
    });
    return result.domains ?? [];
  } catch {
    // Arbiter failure is non-fatal: fall back to keyword-only routing.
    return [];
  }
}

const ARBITER_SYSTEM_PROMPT = `You route a fighter's message to the data domains it is about.
Choose from EXACTLY these domain ids: ${ALL_DOMAINS.join(", ")}.
- weight: scale / weight-cut progress vs target
- fight_week: water-load, sodium, rehydration, the fight-week protocol
- training_load: training volume, sessions, sparring, intensity, techniques drilled, what they are working on / struggling with
- nutrition: food, calories, macros, meals
- fight_score: overall readiness, "how am I doing", limiters
- recovery: readiness, soreness, fatigue
- sleep: sleep quantity / quality

Return ONLY JSON: { "domains": string[] } with at most 3 ids, most relevant first.
If unsure, return the single best-fit domain. Never invent ids outside the list.`;

// ── Prompt builder ────────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  athleteName: string | null;
  facts: string;
  snapshotBlock: string;
  intent: "planny" | "casual";
  domainSummaries: string[];
  safetySummary: string;
  cornermanSummary: string;
  campHistorySummary: string;
  architectSummary: string;
  offSeason: boolean;
}): string {
  const {
    athleteName,
    facts,
    snapshotBlock,
    intent,
    domainSummaries,
    safetySummary,
    cornermanSummary,
    campHistorySummary,
    architectSummary,
    offSeason,
  } = opts;
  const domainBlock =
    domainSummaries.length > 0
      ? `\nDOMAIN DATA (reference, do not recompute):\n${domainSummaries.join("\n")}\n`
      : "";
  // Safety is the highest-priority fact: when present it must shape the reply
  // (firm slow-down / rehydrate tone, never "push harder").
  const safetyBlock = safetySummary
    ? `\n${safetySummary}\nIf a SAFETY note is present, lead with it firmly: advise slowing the cut, rehydrating, and seeing a professional if unwell. NEVER advise pushing harder.\n`
    : "";
  const cornermanBlock = cornermanSummary
    ? `\nTODAY (fight week, reference only): ${cornermanSummary}\n`
    : "";
  const campHistoryBlock = campHistorySummary
    ? `\nCAMP HISTORY (reference, you may cite naturally): ${campHistorySummary}\n`
    : "";
  // Phase-4 off-season: when there is no upcoming fight the coach is a "Camp
  // Architect" — base-building, walk-around weight, WHEN to start the next cut,
  // not an active cut. A short conditional addition to the existing prompt.
  const architectBlock = architectSummary
    ? `\nOFF-SEASON (Camp Architect, reference): ${architectSummary}\n`
    : "";
  const offSeasonDirective = offSeason
    ? `\nOFF-SEASON MODE: There is no upcoming fight. You are the athlete's "Camp Architect" now, not a cut cornerman. Focus on holding a healthy walk-around weight, base-building (aerobic + strength), and WHEN to start the next cut once a fight is booked. Do NOT push an active weight cut or fight-week protocol; there is nothing to cut to yet.\n`
    : "";
  const blockGuidance =
    intent === "planny"
      ? `For a planning question, you MAY add up to 3 blocks of type:
- "checklist": { title (≤40), items: [{ label (≤60), logKey? }] } (1-6 items, imperative)
- "callout": { tone: "info"|"warn", text (≤200) } (one short actionable note)
- "timeline": { title (≤40), steps: [{ when (≤16), label (≤50), value? (≤24) }] } (2-8 steps, LABELS ONLY)
- "action": { label (≤50), description? (≤120), action: { kind: "log_weight"|"log_fluid"|"open_plan"|"open_rehydration" } }`
      : `This is a casual / feelings question. Keep "blocks" EMPTY ([]) unless one short "callout" genuinely helps. No checklists or timelines.`;

  return `You are the "Fight Camp Coach" - an elite combat-sports cut + fight-week cornerman.${athleteName ? ` Your athlete's name is "${athleteName}" - use it when it lands naturally.` : ""}
${offSeasonDirective}
${SECOND_PERSON_DIRECTIVE}

${PROMPT_INJECTION_GUARD_INSTRUCTION}

Output ONLY valid JSON matching this shape:
{ "reply": string, "blocks": Block[], "followups"?: string[] }

RULES (non-negotiable):
- "reply": 1-3 sentences, conversational, reference the REAL numbers in DETERMINISTIC FACTS and DOMAIN DATA below ("you are 0.4 kg over with 3 days out", "training is up 2h on last week"). When DOMAIN DATA shows what the athlete recently drilled or is working on, reference it specifically ("keep sharpening that southpaw entry you drilled"). Never a paragraph.
- NEVER recompute or emit any metric numbers in blocks. The server computes and merges all data cards (weight_target, chart, metric_row, stat_card, list, score_ring) from the facts and DOMAIN DATA below. Do NOT output those block types - emitting them will be discarded.
- ${blockGuidance}
- "followups": 0-3 short suggested questions, each ≤40 chars (e.g. "Plan my water load").
- BANNED: paragraphs, motivational fluff, repeating the deterministic numbers inside blocks, em-dashes (—) or en-dashes (–) anywhere. Use commas or periods.

DETERMINISTIC FACTS (use verbatim, never recompute):
${facts}
${safetyBlock}${cornermanBlock}${architectBlock}${domainBlock}${campHistoryBlock}
${snapshotBlock}`;
}

// ── Block helpers ──────────────────────────────────────────────────────────

/**
 * Filter LLM-emitted blocks so one bad block never nukes the message. The
 * outer schema already validated `ai.blocks`, but the model may slip in a
 * server-owned type or a near-miss; re-validating each block individually
 * keeps the good ones (per spec §4: "invalid individual blocks are filtered,
 * not fatal").
 */
function filterValidBlocks(blocks: CoachBlock[] | undefined): CoachBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter((b) => b != null && typeof b.type === "string");
}

// ── Markdown fallback (step 6) ──────────────────────────────────────────────

/**
 * One plain `callGroqText` call when the structured path exhausts retries.
 * Returns `{ reply: <markdown>, blocks }` — the safety callout, the fight-week
 * cornerman cards, the selected domain cards, the weight spine, and any
 * camp-history card are ALL preserved even on the fallback path (they are
 * deterministic, not LLM-derived, and must never be dropped) so the user still
 * sees their real numbers. Same priority + 6-cap as the happy path; only the
 * LLM narrative blocks are absent.
 */
async function fallbackMarkdown(opts: {
  systemPrompt: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  intent: "planny" | "casual";
  safetyCallout: CoachBlock | null;
  cornermanCards: CoachBlock[];
  architectCards: CoachBlock[];
  domainCards: CoachBlock[];
  spineBlocks: CoachBlock[];
  campHistoryCards: CoachBlock[];
}): Promise<CoachMessage> {
  const blocks: CoachBlock[] = mergeDomainBlocks({
    safetyCallout: opts.safetyCallout,
    cornermanCards: opts.cornermanCards,
    architectCards: opts.architectCards,
    domainCards: opts.domainCards,
    spineBlocks: opts.spineBlocks,
    campHistoryCards: opts.campHistoryCards,
    llmBlocks: [],
    max: 6,
  });
  try {
    const text = await callGroqText({
      model: opts.intent === "planny" ? PLANNY_MODEL : CASUAL_MODEL,
      messages: [
        {
          role: "system",
          content:
            `You are the Fight Camp Coach. Reply in 2-4 short sentences of plain markdown, ` +
            `referencing the athlete's real numbers. No JSON, no headers.`,
        },
        ...opts.messages,
      ],
      temperature: 0.5,
      max_tokens: 500,
      timeoutMs: 12000,
    });
    return { reply: text, blocks };
  } catch {
    // Even the plain call failed: return the deterministic blocks with a
    // safe static reply so the user is never left with nothing.
    return {
      reply:
        "I could not reach the coach right now. Your latest numbers are below — try again in a moment.",
      blocks,
    };
  }
}
