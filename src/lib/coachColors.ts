/**
 * Training Missions — per-discipline accent colours.
 *
 * The CSS custom properties live in `src/index.css` under the `:root` block
 * (e.g. `--coach-bjj`) and are stored as HSL triplets so consumers can apply
 * opacity stops via Tailwind's arbitrary-value syntax:
 *
 *   className="bg-[hsl(var(--coach-bjj)/0.15)]"
 *   style={{ backgroundColor: `hsl(var(${token}) / 0.15)` }}
 *
 * `disciplineToken(sport)` normalises the sport string (case / whitespace
 * insensitive) and returns the matching token name, falling back to the
 * neutral default token when the sport is unknown.
 */

export interface DisciplineSpec {
  /** Canonical lowercase key used by the matcher. */
  key: string;
  /** Display label as it should appear in pills / chips. */
  label: string;
  /** CSS custom property name, including the leading `--`. */
  token: string;
}

export const DISCIPLINES: readonly DisciplineSpec[] = [
  { key: "bjj",        label: "BJJ",        token: "--coach-bjj"        },
  { key: "muay thai",  label: "Muay Thai",  token: "--coach-muay-thai"  },
  { key: "boxing",     label: "Boxing",     token: "--coach-boxing"     },
  { key: "wrestling",  label: "Wrestling",  token: "--coach-wrestling"  },
  { key: "sparring",   label: "Sparring",   token: "--coach-sparring"   },
  { key: "strength",   label: "Strength",   token: "--coach-strength"   },
  { key: "run",        label: "Run",        token: "--coach-run"        },
] as const;

const DEFAULT_TOKEN = "--coach-default";

/** Normalise a free-text sport name to its lookup key. */
function normalise(sport: string): string {
  return sport.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Map a sport string (matching `fight_camp_calendar.sessionType`) to its
 * CSS custom-property name. Unknown sports fall back to `--coach-default`
 * which itself aliases `--primary` for brand consistency.
 */
export function disciplineToken(sport: string): string {
  if (!sport) return DEFAULT_TOKEN;
  const key = normalise(sport);

  // Exact match first
  const exact = DISCIPLINES.find((d) => d.key === key);
  if (exact) return exact.token;

  // Common aliases / partial matches — keep the surface forgiving so a
  // sport saved as e.g. "Running" or "Strength & Conditioning" still
  // lights up the right colour.
  if (key.includes("muay") || key === "thai")             return "--coach-muay-thai";
  if (key.startsWith("box"))                              return "--coach-boxing";
  if (key.startsWith("wrest"))                            return "--coach-wrestling";
  if (key.startsWith("spar"))                             return "--coach-sparring";
  if (key.startsWith("strength") || key.includes("s&c"))  return "--coach-strength";
  if (key.startsWith("run") || key.includes("cardio"))    return "--coach-run";
  if (key === "jiu jitsu" || key.includes("bjj") ||
      key.includes("grappl"))                             return "--coach-bjj";

  return DEFAULT_TOKEN;
}

/** Convenience: get the display label for a sport string. Falls back to the
 *  raw sport (title-cased) so unknown disciplines still render cleanly. */
export function disciplineLabel(sport: string): string {
  if (!sport) return "Training";
  const key = normalise(sport);
  const match = DISCIPLINES.find((d) => d.key === key);
  if (match) return match.label;
  return sport.replace(/\b\w/g, (c) => c.toUpperCase());
}
