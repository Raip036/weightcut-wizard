/** Minimal structural shape needed to judge profile completeness. */
export type CompletableProfile = {
  age?: number | null;
  current_weight_kg?: number | null;
  target_date?: string | null;
  goal_type?: string | null;
} | null | undefined;

/**
 * A profile is complete enough to enter the app when it has the basics
 * (age + current weight). Cutting/losing additionally need a target_date
 * (their deadline). Maintenance ("Train & track") users have NO deadline,
 * so target_date is not required for them.
 */
export function isProfileComplete(p: CompletableProfile): boolean {
  if (!p) return false;
  const hasBasics = (p.age ?? 0) > 0 && (p.current_weight_kg ?? 0) > 0;
  if (!hasBasics) return false;
  if (p.goal_type === "maintaining") return true;
  return !!p.target_date;
}
