/**
 * Shared AI response parsing utilities for all Convex actions.
 * Ported from supabase/functions/_shared/parseResponse.ts (no Deno-specific
 * imports). Handles think-tag stripping, em-dash removal, JSON extraction,
 * and content-filter detection.
 */

export function stripThinkTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/g, "")
    .replace(/<reflection>[\s\S]*?<\/reflection>/g, "")
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
  const filtered = !content && data?.choices?.[0]?.finish_reason === "content_filter";
  return { content: content || null, filtered };
}

function cleanJsonString(text: string): string {
  return text
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, "\\n");
}

export function parseJSON<T = unknown>(text: string): T {
  const cleaned = stripThinkTags(text).trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fallthrough
  }
  const md = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) {
    try {
      return JSON.parse(md[1].trim());
    } catch {
      try {
        return JSON.parse(cleanJsonString(md[1].trim()));
      } catch {
        // continue
      }
    }
  }
  const oStart = cleaned.indexOf("{");
  const oEnd = cleaned.lastIndexOf("}");
  if (oStart !== -1 && oEnd > oStart) {
    const cand = cleaned.slice(oStart, oEnd + 1);
    try {
      return JSON.parse(cand);
    } catch {
      try {
        return JSON.parse(cleanJsonString(cand));
      } catch {
        // continue
      }
    }
  }
  const aStart = cleaned.indexOf("[");
  const aEnd = cleaned.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    const cand = cleaned.slice(aStart, aEnd + 1);
    try {
      return JSON.parse(cand);
    } catch {
      // continue
    }
  }
  throw new Error("Could not parse JSON from AI response");
}
