import { writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeStateMachines } from './state-machine';

const machineSource = (open: string) => `
import { Machine } from '@typeonce/effect-machine'
export const m = Machine.make({
  states: { Closed, ${open} },
  events: [Toggle],
  initial: () => States.initial.Closed(new Closed()),
}).handle({
  Closed: { on: { Toggle: ({ target }) => target.full.${open}(new ${open}()) } },
})
`;

describe('analysis cache', () => {
  it('re-analyzes after the file changes on disk (mtime invalidation)', () => {
    const path = join(tmpdir(), `sm-cache-${process.pid}-${Date.now()}.ts`);
    try {
      writeFileSync(path, machineSource('Open'));
      const first = analyzeStateMachines(path).machines;
      expect(first[0]?.states).toContain('Open');

      // Rewrite with a different target and bump mtime to guarantee a change.
      writeFileSync(path, machineSource('Ajar'));
      const future = Date.now() / 1000 + 10;
      utimesSync(path, future, future);

      const second = analyzeStateMachines(path).machines;
      expect(second[0]?.states).toContain('Ajar');
      expect(second[0]?.states).not.toContain('Open');
    } finally {
      rmSync(path, { force: true });
    }
  });
});
