import type { VoicePace } from "./types";

const PACE_MS: Record<VoicePace, number> = {
  normal: 14,
  slow: 32,
};

export function charIntervalMs(pace: VoicePace | undefined): number {
  return PACE_MS[pace ?? "normal"];
}

const SENTENCE_TERMINALS = new Set([".", "?", "!"]);

export function endsAtSentence(textSoFar: string): boolean {
  if (textSoFar.length === 0) return false;
  return SENTENCE_TERMINALS.has(textSoFar[textSoFar.length - 1]);
}
