// User-defined CUSTOM session types. Under the two-level session model
// these are custom MARTIAL-ART *primaries* (e.g. "Sambo", "Capoeira") —
// they slot into the martial-arts group of the primary picker alongside
// the built-in `MARTIAL_ARTS`. They are NOT activity tags; the optional
// session tag (Sparring, Drilling, …) is a separate, fixed taxonomy.
const STORAGE_KEY = "custom_session_types";

export function getCustomTypes(userId: string): string[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addCustomType(userId: string, type: string): string[] {
  const types = getCustomTypes(userId);
  const trimmed = type.trim();
  if (!trimmed || types.includes(trimmed)) return types;
  const updated = [...types, trimmed];
  localStorage.setItem(`${STORAGE_KEY}_${userId}`, JSON.stringify(updated));
  return updated;
}

export function removeCustomType(userId: string, type: string): string[] {
  const types = getCustomTypes(userId).filter(t => t !== type);
  localStorage.setItem(`${STORAGE_KEY}_${userId}`, JSON.stringify(types));
  return types;
}
