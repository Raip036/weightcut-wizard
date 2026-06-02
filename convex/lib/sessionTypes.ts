// convex/lib/sessionTypes.ts
//
// Backend mirror of the two-level session model in `src/lib/sessionTypes.ts`.
// Convex functions cannot import from `src/`, so the load/contact/normalise
// helpers the actions and queries need are duplicated here. Keep the tag
// load multipliers and the legacy mapping in sync with the client copy.
//
//   PRIMARY  — martial art | "S&C" | "Rest"  (stored in sessionType)
//   TAG      — optional activity descriptor    (stored in sessionTag)

export const SANDC = "S&C";
export const REST = "Rest";
export const GENERIC_MARTIAL_ART = "Martial Arts";

export type PrimaryCategoryKind = "Martial Arts" | "S&C" | "Rest";

const MARTIAL_ARTS = [
  "BJJ",
  "Muay Thai",
  "Boxing",
  "Wrestling",
  "MMA",
  "Judo",
  "Kickboxing",
  "Karate",
];
const MARTIAL_ART_SET: ReadonlySet<string> = new Set([...MARTIAL_ARTS, GENERIC_MARTIAL_ART]);

interface TagDef {
  loadMultiplier: number;
  isContact: boolean;
}

const TAG_LOOKUP: Record<string, TagDef> = {
  Sparring: { loadMultiplier: 1.3, isContact: true },
  "Live Grappling": { loadMultiplier: 1.3, isContact: true },
  "Hard Drilling": { loadMultiplier: 1.15, isContact: false },
  "Pad Work": { loadMultiplier: 1.1, isContact: false },
  "Bag Work": { loadMultiplier: 1.0, isContact: false },
  Drilling: { loadMultiplier: 0.95, isContact: false },
  "Skill / Technical": { loadMultiplier: 0.8, isContact: false },
  Shadowboxing: { loadMultiplier: 0.7, isContact: false },
  Strength: { loadMultiplier: 1.0, isContact: false },
  Conditioning: { loadMultiplier: 0.9, isContact: false },
  Run: { loadMultiplier: 0.9, isContact: false },
  "Z2 / Easy": { loadMultiplier: 0.85, isContact: false },
  Mobility: { loadMultiplier: 0.5, isContact: false },
  Yoga: { loadMultiplier: 0.5, isContact: false },
  Recovery: { loadMultiplier: 0.4, isContact: false },
};

const PRIMARY_FALLBACK_MULTIPLIER: Record<PrimaryCategoryKind, number> = {
  "Martial Arts": 1.0,
  "S&C": 0.9,
  Rest: 0.0,
};

export function sessionCategory(primary: string | null | undefined): PrimaryCategoryKind {
  if (!primary) return "Martial Arts";
  if (primary === REST) return "Rest";
  if (primary === SANDC) return "S&C";
  return "Martial Arts";
}

export function effectiveLoadMultiplier(
  primary: string | null | undefined,
  tag?: string | null,
): number {
  if (tag && TAG_LOOKUP[tag]) return TAG_LOOKUP[tag].loadMultiplier;
  return PRIMARY_FALLBACK_MULTIPLIER[sessionCategory(primary)];
}

export function isContactSession(
  _primary: string | null | undefined,
  tag?: string | null,
): boolean {
  return !!tag && (TAG_LOOKUP[tag]?.isContact ?? false);
}

const LEGACY_ACTIVITY_TO_PRIMARY: Record<string, PrimaryCategoryKind> = {
  Sparring: "Martial Arts",
  "Live Grappling": "Martial Arts",
  "Hard Drilling": "Martial Arts",
  "Pad Work": "Martial Arts",
  "Bag Work": "Martial Arts",
  Drilling: "Martial Arts",
  "Skill / Technical": "Martial Arts",
  Shadowboxing: "Martial Arts",
  Training: "Martial Arts",
  Strength: "S&C",
  Conditioning: "S&C",
  Run: "S&C",
  "Z2 / Easy": "S&C",
  Cardio: "S&C",
  "Easy Run": "S&C",
  "Hard Run": "S&C",
  Mobility: "Rest",
  Yoga: "Rest",
  Recovery: "Rest",
};

const ACTIVITY_TAG_ALIAS: Record<string, string> = {
  Training: "Drilling",
  Cardio: "Conditioning",
  "Easy Run": "Run",
  "Hard Run": "Run",
};

export interface NormalizedSession {
  primary: string;
  tag: string | null;
}

/**
 * Split a stored (sessionType, sessionTag?) pair into {primary, tag}. New
 * rows pass through; legacy rows whose sessionType held an activity string
 * get split. See the client copy for full docs.
 */
export function normalizeLegacySession(
  storedType: string | null | undefined,
  storedTag?: string | null,
): NormalizedSession {
  const type = (storedType ?? "").trim();
  if (storedTag != null && storedTag !== "") {
    return { primary: type || GENERIC_MARTIAL_ART, tag: storedTag };
  }
  if (!type) return { primary: GENERIC_MARTIAL_ART, tag: null };
  if (type === REST) return { primary: REST, tag: null };
  if (type === SANDC) return { primary: SANDC, tag: null };
  if (MARTIAL_ART_SET.has(type)) return { primary: type, tag: null };
  const impliedPrimary = LEGACY_ACTIVITY_TO_PRIMARY[type];
  if (impliedPrimary) {
    const tagId = ACTIVITY_TAG_ALIAS[type] ?? type;
    const primary =
      impliedPrimary === "S&C" ? SANDC : impliedPrimary === "Rest" ? REST : GENERIC_MARTIAL_ART;
    return { primary, tag: TAG_LOOKUP[tagId] ? tagId : null };
  }
  return { primary: type, tag: null };
}
