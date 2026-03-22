import type { ProgramDiff } from './types';

export function renderDiffJSON(
  diff: ProgramDiff,
  options?: { pretty?: boolean },
): string {
  const pretty = options?.pretty ?? true;
  return pretty ? JSON.stringify(diff, null, 2) : JSON.stringify(diff);
}
