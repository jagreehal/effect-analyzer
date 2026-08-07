import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import { buildSourceLinesMap } from './cli';

describe('buildSourceLinesMap', () => {
  it('skips unreadable files instead of failing the run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-source-lines-'));
    try {
      const readable = join(root, 'readable.ts');
      writeFileSync(readable, 'const a = 1;\nconst b = 2;\n', 'utf8');
      const missing = join(root, 'does-not-exist.ts');

      // The unreadable path is listed first: if the skip regressed, the whole
      // effect fails here rather than returning a partial map.
      const map = await Effect.runPromise(buildSourceLinesMap([missing, readable]));

      expect(map.has(missing)).toBe(false);
      expect(map.get(readable)).toEqual(['const a = 1;', 'const b = 2;', '']);
      expect(map.size).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns an empty map when nothing is readable', async () => {
    const map = await Effect.runPromise(
      buildSourceLinesMap(['/nonexistent/a.ts', '/nonexistent/b.ts']),
    );
    expect(map.size).toBe(0);
  });
});
