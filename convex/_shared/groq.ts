/**
 * Unified Groq client + Zod-validated call helper for Convex actions.
 *
 * Reads GROQ_API_KEY from process.env. All actions go through `callGroq()`
 * (a single fetch with a 15s connect timeout) or `callGroqWithRetry()` (which
 * adds Zod validation + up to 2 retries with appended error feedback).
 *
 * Throws a typed `GroqError` on failure so action handlers can short-circuit
 * cleanly. Feature-gate (`PRO_FEATURE_REQUIRED:*`) and authentication checks
 * happen BEFORE this is called.
 */

import type { z } from "zod";
import { extractContent, parseJSON } from "./parseResponse";

export class GroqError extends Error {
  constructor(
    message: string,
    public code: "AI_TIMEOUT" | "AI_BUSY" | "AI_AUTH" | "AI_FILTERED" | "AI_UNKNOWN",
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "GroqError";
  }
}

/**
 * OpenAI-compatible message content. Plain text for chat-only models;
 * the array form is used for vision (image_url parts) in analyze-meal.
 */
export type GroqMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

export interface GroqCallOptions {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: GroqMessageContent }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  reasoning_effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

/**
 * Raw OpenAI-compatible chat completion response shape. Only the fields
 * we actually read are listed; Groq passes through extras unchanged.
 */
export interface GroqChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function getGroqKey(): string {
  const key =
    typeof process !== "undefined" && process.env
      ? process.env.GROQ_API_KEY
      : undefined;
  if (!key) throw new GroqError("GROQ_API_KEY is not configured", "AI_AUTH");
  return key;
}

/**
 * Raw Groq call. Returns the parsed response JSON. Throws GroqError on any
 * non-2xx or timeout. Use this when you need to massage payloads manually
 * (e.g. multi-stage analyze-meal).
 */
export async function callGroqRaw(opts: GroqCallOptions): Promise<GroqChatCompletionResponse> {
  const key = getGroqKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
        ...(opts.response_format ? { response_format: opts.response_format } : {}),
        ...(opts.reasoning_effort ? { reasoning_effort: opts.reasoning_effort } : {}),
      }),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GroqError("AI service timed out", "AI_TIMEOUT");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 429)
      throw new GroqError("AI service is busy", "AI_BUSY", 429);
    if (response.status === 401 || response.status === 403)
      throw new GroqError("Invalid Groq API key", "AI_AUTH", response.status);
    throw new GroqError(
      `Groq API error: ${errorData?.error?.message || "unknown"}`,
      "AI_UNKNOWN",
      response.status,
    );
  }
  return await response.json();
}

/**
 * High-level helper: calls Groq and returns the extracted text content.
 * Throws GroqError if Groq filtered the response or returned no content.
 */
export async function callGroqText(opts: GroqCallOptions): Promise<string> {
  const data = await callGroqRaw(opts);
  const { content, filtered } = extractContent(data);
  if (!content) {
    if (filtered) throw new GroqError("Content was filtered for safety", "AI_FILTERED");
    throw new GroqError("No response from Groq API", "AI_UNKNOWN");
  }
  return content;
}

/**
 * High-level helper: calls Groq, parses JSON, and validates against a Zod
 * schema with up to maxRetries retries on validation failure. The retry
 * prompt is appended to the system message of the retried request.
 */
export interface GroqJSONOptions<T extends z.ZodTypeAny> extends GroqCallOptions {
  schema: T;
  maxRetries?: number;
}

// Codes that should bypass retries — these are unrecoverable / require
// user action and re-trying them just burns the user's time.
const FATAL_GROQ_CODES = new Set(["AI_AUTH", "AI_FILTERED"]);

// Sleep helper used for exponential backoff between retries on transient
// Groq failures. Capped well under the action's 15s outer timeout so we
// don't trip an AbortError before exhausting attempts.
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export async function callGroqWithRetry<T extends z.ZodTypeAny>(
  opts: GroqJSONOptions<T>,
): Promise<z.infer<T>> {
  // Bumped default from 2 → 3 since the most common failure mode is
  // transient Groq capacity (429 "AI_BUSY"). Three attempts with backoff
  // covers > 95% of those without making the user wait >12s.
  const maxRetries = Math.max(0, opts.maxRetries ?? 3);
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let messages = opts.messages;
    if (lastErrors.length > 0 && messages.length > 0 && messages[0].role === "system") {
      const feedback = [
        "",
        "IMPORTANT: Your previous JSON had validation errors:",
        ...lastErrors.map((e) => `  - ${e}`),
        "Return strict JSON that matches the schema exactly.",
      ].join("\n");
      messages = [
        { ...messages[0], content: `${messages[0].content}\n${feedback}` },
        ...messages.slice(1),
      ];
    }
    let content: string;
    try {
      content = await callGroqText({ ...opts, messages });
    } catch (err) {
      // Old behaviour: re-throw EVERY GroqError immediately. That meant
      // a single transient 429 ("AI service is busy") killed plan
      // generation and the user saw the inline retry card with no
      // actual retry attempted under the hood. We now distinguish
      // fatal codes from transient ones and back off + retry the
      // transient cases (busy / timeout / network blips).
      if (err instanceof GroqError && FATAL_GROQ_CODES.has(err.code)) {
        throw err;
      }
      lastErrors = [
        `request_error: ${err instanceof Error ? err.message : String(err)}`,
      ];
      if (attempt >= maxRetries) throw err;
      // Exponential backoff with jitter: 600 / 1400 / 2400 ms approx.
      // Stays well inside the per-action timeout budget.
      const base = 400 + 800 * attempt;
      const jitter = Math.floor(Math.random() * 200);
      await sleep(base + jitter);
      continue;
    }
    let raw: unknown;
    try {
      raw = parseJSON(content);
    } catch (e) {
      lastErrors = [`parse_error: ${e instanceof Error ? e.message : String(e)}`];
      if (attempt >= maxRetries) throw e;
      continue;
    }
    const parsed = opts.schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastErrors = parsed.error.errors.slice(0, 12).map((e) => {
      const path = e.path.length ? e.path.join(".") : "(root)";
      return `${path}: ${e.message}`;
    });
    if (attempt >= maxRetries) {
      throw new GroqError(
        `Zod validation failed after ${maxRetries + 1} attempts: ${lastErrors.join("; ")}`,
        "AI_UNKNOWN",
      );
    }
  }
  throw new GroqError("Unreachable", "AI_UNKNOWN");
}

/** Build a JSON-shaped error envelope for actions to throw, matching the
 *  status codes the legacy Supabase functions used. */
export function groqErrorMessage(err: unknown): { message: string; code?: string } {
  if (err instanceof GroqError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err) };
}
