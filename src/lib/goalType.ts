export type GoalType = 'cutting' | 'losing' | 'maintaining' | 'gaining';

export const FIGHT_ONLY_PATHS = ['/fight-camps', '/weight-cut', '/weight-protocol'];

// "maintaining" and "losing" are non-fight personas. Callers that mean
// "this user has an active weight-cut target" should check for "maintaining"
// separately (isFighter returns true for it because it !== 'losing').
export function isFighter(goalType?: string): boolean {
  return goalType !== 'losing';
}
