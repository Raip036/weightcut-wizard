/**
 * Shared AI response parsing utilities for all Convex actions.
 * Ported from supabase/functions/_shared/parseResponse.ts (no Deno-specific
 * imports). Handles think-tag stripping, em-dash removal, JSON extraction,
 * and content-filter detection.
 */

export function stripThinkTags(text: string): string {
  // Strip all known "reasoning prose" XML wrappers case-insensitively.
  // Models like Gemini 2.5, Claude, and DeepSeek emit these around their
  // internal monologue before the actual JSON payload.
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, "")
    .replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, "")
    .trim();
}

export function stripEmDashes(text: string): string {
  return text.replace(/—/g, " - ").replace(/–/g, "-");
}

interface ChatCompletionLike {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
}

export function extractContent(data: ChatCompletionLike | null | undefined): {
  content: string | null;
  filtered: boolean;
} {
  let content: string | null | undefined = data?.choices?.[0]?.message?.content;
  if (!content && data?.choices?.[0]?.message?.reasoning_content) {
    content = data.choices[0].message.reasoning_content;
  }
  if (content) {
    content = stripThinkTags(content);
    content = stripEmDashes(content);
  }
  const filtered =
    !content && data?.choices?.[0]?.finish_reason === "content_filter";
  return { content: content || null, filtered };
}

function cleanJsonString(text: string): string {
  return text
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, "\\n");
}

/**
 * Try parsing a candidate substring, first as-is, then with cleanJsonString().
 * Returns the parsed value or undefined on failure.
 */
function tryParseCandidate<T>(cand: string): T | undefined {
  try {
    return JSON.parse(cand) as T;
  } catch {
    try {
      return JSON.parse(cleanJsonString(cand)) as T;
    } catch {
      return undefined;
    }
  }
}

/**
 * Scan the string for every balanced {...} substring using a depth counter
 * that respects string literals and escapes. Returns all candidates sorted
 * by length descending so the largest valid JSON wins.
 */
function findBalancedBraceCandidates(
  text: string,
  open: string,
  close: string,
): string[] {
  const candidates: string[] = [];
  const len = text.length;
  for (let i = 0; i < len; i++) {
    if (text[i] !== open) continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < len; j++) {
      const ch = text[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(i, j + 1));
          break;
        }
      }
    }
  }
  // Longest first — outermost / most complete JSON usually wins.
  candidates.sort((a, b) => b.length - a.length);
  return candidates;
}

/**
 * Salvage a TRUNCATED JSON object/array (model cut off mid-output by a
 * max_tokens limit). Walk once from the first `{`/`[`, tracking the open
 * container stack and string state. Cut back to the end of the last value
 * that completed OUTSIDE a string, drop any dangling comma, then close every
 * still-open container in reverse (innermost-first) order. Returns the parsed
 * value, or undefined when nothing salvageable is found.
 */
function tryParseTruncated<T>(text: string): T | undefined {
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  const s = text.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let cut = -1; // exclusive end of the last completed value, outside strings
  let cutStack: string[] = []; // open-container snapshot AT the cut point
  const mark = (i: number) => {
    cut = i + 1;
    cutStack = stack.slice();
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      if (!inString) mark(i); // a string literal just closed
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      mark(i); // container closed — snapshot reflects post-pop state
    } else if (/[\dtruefalsn]/i.test(ch)) {
      // tail of a number / true / false / null literal
      mark(i);
    }
  }
  // Close only the containers that were still open AT the cut point — the
  // end-of-string stack may include a partial trailing item we discarded.
  if (cutStack.length === 0 || cut === -1) return undefined;
  const closers = cutStack.reverse().join("");
  let body = s.slice(0, cut).replace(/,\s*$/, "");
  // Try to close as-is; if that leaves a dangling object key with no value
  // (truncation landed after `"key":` or mid value-string), strip the
  // trailing key and retry — the loop peels nested partials one level at a
  // time. Container nesting is unchanged by stripping a key, so `closers`
  // stays valid across attempts.
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = tryParseCandidate<T>(body + closers);
    if (r !== undefined) return r;
    const stripped = body
      .replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, "")
      .replace(/,\s*$/, "");
    if (stripped === body) break;
    body = stripped;
  }
  return undefined;
}

function snippetForError(text: string): string {
  const head = text.slice(0, 200).replace(/\s+/g, " ");
  const tail = text.length > 200 ? text.slice(-200).replace(/\s+/g, " ") : "";
  return tail ? `head="${head}" ... tail="${tail}"` : `text="${head}"`;
}

export function parseJSON<T = unknown>(text: string): T {
  const cleaned = stripThinkTags(text).trim();

  // 1. Strict parse.
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fallthrough
  }

  // 1b. Strict parse with json5-ish cleanup applied to the whole string.
  {
    const r = tryParseCandidate<T>(cleaned);
    if (r !== undefined) return r;
  }

  // 2. Markdown fence ```json ... ```
  const md = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) {
    const r = tryParseCandidate<T>(md[1].trim());
    if (r !== undefined) return r;
  }

  // 3. First `{` to last `}` (existing behaviour preserved).
  const oStart = cleaned.indexOf("{");
  const oEnd = cleaned.lastIndexOf("}");
  if (oStart !== -1 && oEnd > oStart) {
    const r = tryParseCandidate<T>(cleaned.slice(oStart, oEnd + 1));
    if (r !== undefined) return r;
  }

  // 4. First `[` to last `]` (existing behaviour preserved).
  const aStart = cleaned.indexOf("[");
  const aEnd = cleaned.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    const r = tryParseCandidate<T>(cleaned.slice(aStart, aEnd + 1));
    if (r !== undefined) return r;
  }

  // 5. Multi-candidate balanced brace walk for objects, longest first.
  for (const cand of findBalancedBraceCandidates(cleaned, "{", "}")) {
    const r = tryParseCandidate<T>(cand);
    if (r !== undefined) return r;
  }

  // 6. Multi-candidate balanced bracket walk for arrays, longest first.
  for (const cand of findBalancedBraceCandidates(cleaned, "[", "]")) {
    const r = tryParseCandidate<T>(cand);
    if (r !== undefined) return r;
  }

  // 7. Last resort: salvage a TRUNCATED object/array. Reasoning models that
  //    hit max_tokens leave unbalanced braces, which every step above
  //    rejects (a truncated object never closes to depth 0, so steps 5/6
  //    find zero candidates). Recovering a slightly-incomplete object beats
  //    a hard failure — e.g. logging 8 of 10 meal items.
  {
    const r = tryParseTruncated<T>(cleaned);
    if (r !== undefined) return r;
  }

  throw new Error(
    `Could not parse JSON from AI response (${snippetForError(cleaned)})`,
  );
}
