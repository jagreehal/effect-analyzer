import { describe, expect, it } from 'vitest';
import {
  deriveOpportunityKey,
  diffMigrationSnapshots,
  formatMigrationDelta,
  snapshotFile,
} from './migration-progress';

const LEGACY = `
async function getUser(id: string) {
  try {
    const res = await fetch('/api/users/' + id);
    return res.json();
  } catch (error) {
    throw error;
  }
}
`;

// Same logic, try/catch + fetch removed, but with extra blank lines prepended so
// every remaining pattern sits on a *different line number* than before.
const PARTLY_MIGRATED = `



import { Effect } from 'effect';

const getUser = (id: string) =>
  Effect.tryPromise(() => fetch('/api/users/' + id)).pipe(
    Effect.flatMap((res) => Effect.promise(() => res.json())),
  );

function unrelated() {
  return Promise.all([Promise.resolve(1)]);
}
`;

describe('migration-progress', () => {
  it('keys are independent of line number (stable under edits)', () => {
    const opp = {
      filePath: 'a.ts',
      line: 10,
      column: 3,
      pattern: 'try/catch',
      suggestion: 'Effect.try',
      codeSnippet: 'try { foo() }',
    };
    const moved = { ...opp, line: 999, column: 1 };
    expect(deriveOpportunityKey(opp, 0)).toBe(deriveOpportunityKey(moved, 0));
  });

  it('counts fixed patterns even when remaining ones moved lines', () => {
    const prev = snapshotFile('svc.ts', '2026-01-01T00:00:00Z', LEGACY);
    const curr = snapshotFile('svc.ts', '2026-01-02T00:00:00Z', PARTLY_MIGRATED);

    const delta = diffMigrationSnapshots(prev, curr);

    // try/catch and throw were removed → counted as fixed, not as moved.
    const fixedPatterns = delta.fixed.map((o) => o.pattern);
    expect(fixedPatterns).toContain('try/catch');
    expect(fixedPatterns).toContain('throw');

    // Promise.all is brand new in the second file.
    expect(delta.added.map((o) => o.pattern)).toContain('Promise.all');

    expect(delta.progress).toBeGreaterThan(0);
    expect(delta.progress).toBeLessThanOrEqual(1);
  });

  it('reports 100% progress when all opportunities are gone', () => {
    const prev = snapshotFile('svc.ts', '2026-01-01T00:00:00Z', LEGACY);
    const curr = snapshotFile('svc.ts', '2026-01-02T00:00:00Z', `export const x = 1;\n`);

    const delta = diffMigrationSnapshots(prev, curr);
    expect(delta.remainingCount).toBe(0);
    expect(delta.progress).toBe(1);
    expect(formatMigrationDelta(delta)).toContain('100%');
  });

  it('reports 0% progress when a clean snapshot regresses', () => {
    const prev = snapshotFile('svc.ts', '2026-01-01T00:00:00Z', `export const x = 1;\n`);
    const curr = snapshotFile('svc.ts', '2026-01-02T00:00:00Z', LEGACY);

    const delta = diffMigrationSnapshots(prev, curr);
    expect(delta.fixedCount).toBe(0);
    expect(delta.remainingCount).toBe(0);
    expect(delta.addedCount).toBeGreaterThan(0);
    expect(delta.progress).toBe(0);
    expect(formatMigrationDelta(delta)).toContain('0%');
  });

  it('does not collapse two identical patterns in the same file to one key', () => {
    const src = `
      function f() { throw new Error('a'); }
      function g() { throw new Error('a'); }
    `;
    const snap = snapshotFile('dup.ts', '2026-01-01T00:00:00Z', src);
    const throws = snap.opportunities.filter((o) => o.pattern === 'throw');
    expect(throws.length).toBe(2);

    // Diffing a snapshot against itself: both throws must survive as "remaining",
    // proving the two identical snippets get distinct keys.
    const delta = diffMigrationSnapshots(snap, snap);
    expect(delta.remaining.filter((o) => o.pattern === 'throw').length).toBe(2);
    expect(delta.fixedCount).toBe(0);
  });
});
