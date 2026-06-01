// src/lib/sessionTypes.ts

export const SESSION_TYPE_CATEGORIES = [
  {
    label: 'Combat',
    types: [
      { id: 'Sparring',        icon: 'flameOutline',     loadMultiplier: 1.30, isContact: true },
      { id: 'Live Grappling',  icon: 'fitnessOutline',   loadMultiplier: 1.30, isContact: true },
      { id: 'Hard Drilling',   icon: 'pulseOutline',     loadMultiplier: 1.15 },
      { id: 'Pad Work',        icon: 'handLeftOutline',  loadMultiplier: 1.10 },
      { id: 'Bag Work',        icon: 'cubeOutline',      loadMultiplier: 1.00 },
      { id: 'Drilling',        icon: 'repeatOutline',    loadMultiplier: 0.95 },
    ],
  },
  {
    label: 'Conditioning',
    types: [
      { id: 'Strength',        icon: 'barbellOutline',   loadMultiplier: 1.00 },
      { id: 'Conditioning',    icon: 'flashOutline',     loadMultiplier: 0.90 },
      { id: 'Run',             icon: 'walkOutline',      loadMultiplier: 0.90 },
      { id: 'Z2 / Easy',       icon: 'leafOutline',      loadMultiplier: 0.85 },
    ],
  },
  {
    label: 'Skill',
    types: [
      { id: 'Skill / Technical', icon: 'bulbOutline',         loadMultiplier: 0.80 },
      { id: 'Shadowboxing',      icon: 'reorderTwoOutline',   loadMultiplier: 0.70 },
    ],
  },
  {
    label: 'Recovery',
    types: [
      { id: 'Mobility',  icon: 'leafOutline',  loadMultiplier: 0.50 },
      { id: 'Yoga',      icon: 'leafOutline',  loadMultiplier: 0.50 },
      { id: 'Recovery',  icon: 'heartOutline', loadMultiplier: 0.40 },
      { id: 'Rest',      icon: 'moonOutline',  loadMultiplier: 0.00 },
    ],
  },
] as const;

export type SessionType = typeof SESSION_TYPE_CATEGORIES[number]['types'][number]['id'];

export const ALL_SESSION_TYPES: readonly string[] = SESSION_TYPE_CATEGORIES.flatMap(c => c.types.map(t => t.id));

export const CONTACT_SESSION_TYPES: ReadonlySet<string> = new Set(
  SESSION_TYPE_CATEGORIES.flatMap(c => c.types.filter(t => 'isContact' in t && (t as any).isContact).map(t => t.id))
);

// Lookup helpers
const TYPE_LOOKUP = new Map<string, { loadMultiplier: number; isContact: boolean; category: string }>();
for (const cat of SESSION_TYPE_CATEGORIES) {
  for (const t of cat.types) {
    TYPE_LOOKUP.set(t.id, {
      loadMultiplier: t.loadMultiplier,
      isContact: 'isContact' in t && (t as any).isContact === true,
      category: cat.label,
    });
  }
}

// Legacy aliases — normalize older free-form strings to the new taxonomy.
const LEGACY_ALIASES: Record<string, string> = {
  'Training': 'Drilling',
  'Cardio': 'Conditioning',
  'Easy Run': 'Run',
  'Hard Run': 'Run',
  'BJJ': 'Drilling',
  'MMA': 'Drilling',
};

export function normalizeSessionType(input: string | null | undefined): string {
  if (!input) return 'Drilling';
  if (TYPE_LOOKUP.has(input)) return input;
  return LEGACY_ALIASES[input] ?? input; // unknown strings pass through; load model uses neutral 1.0×
}

export function sportLoadMultiplier(sessionType: string): number {
  return TYPE_LOOKUP.get(normalizeSessionType(sessionType))?.loadMultiplier ?? 1.0;
}

export function isContactSession(sessionType: string): boolean {
  return TYPE_LOOKUP.get(normalizeSessionType(sessionType))?.isContact ?? false;
}

export function sessionCategory(sessionType: string): string | null {
  return TYPE_LOOKUP.get(normalizeSessionType(sessionType))?.category ?? null;
}
