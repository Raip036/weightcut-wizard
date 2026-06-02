// src/lib/sessionTypes.ts
//
// Two-level training-session model:
//
//   PRIMARY  — the discipline a session belongs to. Exactly one of:
//                • a martial art (BJJ, Muay Thai, Boxing, …)  — or a custom one
//                • "S&C"  (strength & conditioning)
//                • "Rest"
//              This is the field the training calendar and the AI coach key
//              off. Stored in `fight_camp_calendar.sessionType` /
//              `gym_sessions.sessionType`.
//
//   TAG      — an OPTIONAL descriptor of WHAT the session actually was
//              (Sparring, Live Grappling, Drilling, Strength, Run, …). Stored
//              in the new `sessionTag` column. Drives the training-load model
//              and contact / concussion tracking. When absent, load falls back
//              to a sensible per-primary default (see PRIMARY_FALLBACK_MULTIPLIER).
//
// Migrate-on-read: older rows stored a single activity string in
// `sessionType` (e.g. "Sparring", "Strength"). `normalizeLegacySession`
// splits those into {primary, tag} so every consumer sees the new shape
// without a database rewrite.

/* ── Primary categories ───────────────────────────────────────────────── */

export const MARTIAL_ARTS = [
  'BJJ',
  'Muay Thai',
  'Boxing',
  'Wrestling',
  'MMA',
  'Judo',
  'Kickboxing',
  'Karate',
] as const;

export const SANDC = 'S&C';
export const REST = 'Rest';
/** Catch-all bucket for legacy rows whose specific art can't be inferred. */
export const GENERIC_MARTIAL_ART = 'Martial Arts';

export type PrimaryCategoryKind = 'Martial Arts' | 'S&C' | 'Rest';

/** Picker structure for the log form's primary selector. */
export const PRIMARY_CATEGORIES = [
  { label: 'Martial Arts', kind: 'Martial Arts' as const, options: [...MARTIAL_ARTS] },
  { label: 'Strength & Conditioning', kind: 'S&C' as const, options: [SANDC] },
  { label: 'Rest', kind: 'Rest' as const, options: [REST] },
] as const;

const MARTIAL_ART_SET: ReadonlySet<string> = new Set([...MARTIAL_ARTS, GENERIC_MARTIAL_ART]);

/* ── Optional session-type tags ───────────────────────────────────────── */

export interface SessionTagDef {
  id: string;
  loadMultiplier: number;
  isContact?: boolean;
  /** Which primary category this tag is offered under in the UI. */
  appliesTo: PrimaryCategoryKind;
  icon?: string;
}

export const SESSION_TAG_GROUPS: {
  label: string;
  appliesTo: PrimaryCategoryKind;
  tags: SessionTagDef[];
}[] = [
  {
    label: 'Combat',
    appliesTo: 'Martial Arts',
    tags: [
      { id: 'Sparring',         loadMultiplier: 1.30, isContact: true, appliesTo: 'Martial Arts', icon: 'flameOutline' },
      { id: 'Live Grappling',   loadMultiplier: 1.30, isContact: true, appliesTo: 'Martial Arts', icon: 'fitnessOutline' },
      { id: 'Hard Drilling',    loadMultiplier: 1.15, appliesTo: 'Martial Arts', icon: 'pulseOutline' },
      { id: 'Pad Work',         loadMultiplier: 1.10, appliesTo: 'Martial Arts', icon: 'handLeftOutline' },
      { id: 'Bag Work',         loadMultiplier: 1.00, appliesTo: 'Martial Arts', icon: 'cubeOutline' },
      { id: 'Drilling',         loadMultiplier: 0.95, appliesTo: 'Martial Arts', icon: 'repeatOutline' },
      { id: 'Skill / Technical', loadMultiplier: 0.80, appliesTo: 'Martial Arts', icon: 'bulbOutline' },
      { id: 'Shadowboxing',     loadMultiplier: 0.70, appliesTo: 'Martial Arts', icon: 'reorderTwoOutline' },
    ],
  },
  {
    label: 'S&C',
    appliesTo: 'S&C',
    tags: [
      { id: 'Strength',     loadMultiplier: 1.00, appliesTo: 'S&C', icon: 'barbellOutline' },
      { id: 'Conditioning', loadMultiplier: 0.90, appliesTo: 'S&C', icon: 'flashOutline' },
      { id: 'Run',          loadMultiplier: 0.90, appliesTo: 'S&C', icon: 'walkOutline' },
      { id: 'Z2 / Easy',    loadMultiplier: 0.85, appliesTo: 'S&C', icon: 'leafOutline' },
    ],
  },
  {
    label: 'Recovery',
    appliesTo: 'Rest',
    tags: [
      { id: 'Mobility', loadMultiplier: 0.50, appliesTo: 'Rest', icon: 'leafOutline' },
      { id: 'Yoga',     loadMultiplier: 0.50, appliesTo: 'Rest', icon: 'leafOutline' },
      { id: 'Recovery', loadMultiplier: 0.40, appliesTo: 'Rest', icon: 'heartOutline' },
    ],
  },
];

export const ALL_SESSION_TAGS: readonly string[] = SESSION_TAG_GROUPS.flatMap(g => g.tags.map(t => t.id));

const TAG_LOOKUP = new Map<string, SessionTagDef>();
for (const g of SESSION_TAG_GROUPS) for (const t of g.tags) TAG_LOOKUP.set(t.id, t);

export const CONTACT_SESSION_TAGS: ReadonlySet<string> = new Set(
  [...TAG_LOOKUP.values()].filter(t => t.isContact).map(t => t.id),
);

export function isKnownTag(tag: string | null | undefined): boolean {
  return !!tag && TAG_LOOKUP.has(tag);
}

/** Tag definitions offered for a given primary (drives the optional tag picker). */
export function tagsForPrimary(primary: string | null | undefined): SessionTagDef[] {
  const kind = sessionCategory(primary);
  return SESSION_TAG_GROUPS.filter(g => g.appliesTo === kind).flatMap(g => g.tags);
}

/* ── Primary classification ───────────────────────────────────────────── */

export function sessionCategory(primary: string | null | undefined): PrimaryCategoryKind {
  if (!primary) return 'Martial Arts';
  if (primary === REST) return 'Rest';
  if (primary === SANDC) return 'S&C';
  return 'Martial Arts'; // any art (known or custom) is a martial-arts primary
}

/** Fallback load multiplier when a session has no tag. */
const PRIMARY_FALLBACK_MULTIPLIER: Record<PrimaryCategoryKind, number> = {
  'Martial Arts': 1.0,
  'S&C': 0.9,
  Rest: 0.0,
};

/* ── Load + contact derivation ────────────────────────────────────────── */

/**
 * Training-load multiplier for a session. The tag wins when present and
 * recognised; otherwise we fall back to the primary category's default.
 */
export function effectiveLoadMultiplier(
  primary: string | null | undefined,
  tag?: string | null,
): number {
  if (tag) {
    const def = TAG_LOOKUP.get(tag);
    if (def) return def.loadMultiplier;
  }
  return PRIMARY_FALLBACK_MULTIPLIER[sessionCategory(primary)];
}

/** Contact (concussion/round-tracking) sessions are tag-driven only. */
export function isContactSession(
  _primary: string | null | undefined,
  tag?: string | null,
): boolean {
  return !!tag && CONTACT_SESSION_TAGS.has(tag);
}

export function isRestSession(primary: string | null | undefined): boolean {
  return sessionCategory(primary) === 'Rest';
}

/* ── Migrate-on-read: map legacy single-field values to {primary, tag} ─── */

/** Activity strings that should become TAGS, with the primary they imply. */
const LEGACY_ACTIVITY_TO_PRIMARY: Record<string, PrimaryCategoryKind> = {
  // combat activities → generic martial arts
  Sparring: 'Martial Arts',
  'Live Grappling': 'Martial Arts',
  'Hard Drilling': 'Martial Arts',
  'Pad Work': 'Martial Arts',
  'Bag Work': 'Martial Arts',
  Drilling: 'Martial Arts',
  'Skill / Technical': 'Martial Arts',
  Shadowboxing: 'Martial Arts',
  Training: 'Martial Arts',
  // strength & conditioning
  Strength: 'S&C',
  Conditioning: 'S&C',
  Run: 'S&C',
  'Z2 / Easy': 'S&C',
  Cardio: 'S&C',
  'Easy Run': 'S&C',
  'Hard Run': 'S&C',
  // recovery
  Mobility: 'Rest',
  Yoga: 'Rest',
  Recovery: 'Rest',
};

/** Normalise legacy activity strings to a canonical tag id. */
const ACTIVITY_TAG_ALIAS: Record<string, string> = {
  Training: 'Drilling',
  Cardio: 'Conditioning',
  'Easy Run': 'Run',
  'Hard Run': 'Run',
};

export interface NormalizedSession {
  primary: string;
  tag: string | null;
}

/**
 * Split a stored (sessionType, sessionTag?) pair into the canonical
 * {primary, tag} shape. New-model rows (which already carry a tag) pass
 * through; legacy rows whose `sessionType` held an activity string get
 * split into a primary + tag.
 */
export function normalizeLegacySession(
  storedType: string | null | undefined,
  storedTag?: string | null,
): NormalizedSession {
  const type = (storedType ?? '').trim();

  // New-model row: a tag is already stored → storedType is the primary.
  if (storedTag != null && storedTag !== '') {
    return { primary: type || GENERIC_MARTIAL_ART, tag: storedTag };
  }
  if (!type) return { primary: GENERIC_MARTIAL_ART, tag: null };

  // Already a primary value.
  if (type === REST) return { primary: REST, tag: null };
  if (type === SANDC) return { primary: SANDC, tag: null };
  if (MARTIAL_ART_SET.has(type)) return { primary: type, tag: null };

  // A legacy activity string → split into primary + tag.
  const impliedPrimary = LEGACY_ACTIVITY_TO_PRIMARY[type];
  if (impliedPrimary) {
    const tagId = ACTIVITY_TAG_ALIAS[type] ?? type;
    const primary =
      impliedPrimary === 'S&C' ? SANDC : impliedPrimary === 'Rest' ? REST : GENERIC_MARTIAL_ART;
    return { primary, tag: TAG_LOOKUP.has(tagId) ? tagId : null };
  }

  // Unknown string → treat as a custom martial-art primary.
  return { primary: type, tag: null };
}

/** True for legacy rows that landed in the generic catch-all bucket. */
export function isUncategorizedPrimary(primary: string | null | undefined): boolean {
  return primary === GENERIC_MARTIAL_ART;
}
