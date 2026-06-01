export type GoalType = 'cutting' | 'losing';

export const FIGHT_ONLY_PATHS = ['/fight-camps', '/weight-cut', '/weight-protocol'];

export function isFighter(goalType?: string): boolean {
  return goalType !== 'losing';
}
