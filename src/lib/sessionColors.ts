// Keyed by PRIMARY category (martial art / "S&C" / "Rest"). The legacy
// activity keys (Sparring, Strength, …) are kept so historical rows that
// haven't been re-categorised still resolve a colour during migrate-on-read.
export const DEFAULT_SPORT_COLORS: Record<string, string> = {
  // Martial-art primaries
  BJJ: "#3b82f6",
  "Muay Thai": "#ef4444",
  Boxing: "#f97316",
  Wrestling: "#f59e0b",
  MMA: "#a855f7",
  Judo: "#14b8a6",
  Kickboxing: "#e11d48",
  Karate: "#facc15",
  "Martial Arts": "#fb923c",
  // Other primaries
  "S&C": "#22c55e",
  Rest: "#60a5fa",
  // Legacy activity keys (pre-migration fallbacks)
  Sparring: "#fb923c",
  Strength: "#22c55e",
  Conditioning: "#10b981",
  Run: "#06b6d4",
  Recovery: "#8b5cf6",
  Other: "#6b7280",
};

export const COLOR_PALETTE = [
  "#3b82f6", "#ef4444", "#f97316", "#f59e0b",
  "#fb923c", "#22c55e", "#10b981", "#06b6d4",
  "#8b5cf6", "#60a5fa", "#6b7280", "#ec4899",
  "#a855f7", "#14b8a6", "#e11d48", "#facc15",
];

const STORAGE_KEY = "session_type_colors";

export function getUserColors(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${userId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setUserColor(userId: string, sessionType: string, color: string) {
  const current = getUserColors(userId);
  current[sessionType] = color;
  localStorage.setItem(`${STORAGE_KEY}_${userId}`, JSON.stringify(current));
}

export function getSessionColor(sessionType: string, customColors?: Record<string, string>): string {
  return customColors?.[sessionType] ?? DEFAULT_SPORT_COLORS[sessionType] ?? "#6b7280";
}
