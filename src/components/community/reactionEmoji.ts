/**
 * Shared reaction slug → emoji mapping. This is the single source of truth
 * consumed by both the reaction bar (EmojiReactionBar) and the activity feed
 * row (ActivityRow), so the slug → emoji translation lives in exactly one
 * place. The server stores ASCII slugs on the wire (Convex rejects emoji
 * characters as record keys); the emoji is a pure presentation concern.
 */
export const REACTION_EMOJI: Record<string, string> = {
  heart: "❤️",
  fire: "🔥",
  muscle: "💪",
  praise: "🙌",
  clap: "👏",
};

export const REACTION_KEYS_IN_ORDER = ["heart", "fire", "muscle", "praise", "clap"] as const;

export function reactionEmoji(key: string): string {
  return REACTION_EMOJI[key] ?? "👍";
}
