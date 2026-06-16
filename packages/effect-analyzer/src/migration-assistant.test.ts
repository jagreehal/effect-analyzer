import { describe, expect, it } from 'vitest';
import { findMigrationOpportunities } from './migration-assistant';

// Source whose line numbers are easy to assert against. Line 1 is the first
// line of the template literal (the leading newline), so `const SRC` content
// starts on line 2.
const SRC = `
async function fetchUser(id: string) {
  try {
    const response = await fetch('/api/users/' + id);
    return response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}
`;

describe('migration-assistant: location + snippet accuracy', () => {
  const opps = findMigrationOpportunities('virtual.ts', SRC);

  const byPattern = (p: string) => opps.find((o) => o.pattern === p);

  it('reports the exact line of the try/catch (no off-by-one)', () => {
    const tryCatch = byPattern('try/catch');
    expect(tryCatch).toBeDefined();
    // `try {` is on line 3 of SRC.
    expect(tryCatch!.line).toBe(3);
  });

  it('reports the exact line of the fetch() call', () => {
    const fetchCall = byPattern('fetch()');
    expect(fetchCall).toBeDefined();
    // `await fetch(...)` is on line 4.
    expect(fetchCall!.line).toBe(4);
  });

  it('attributes the snippet to the matched node, not a neighbouring one', () => {
    const tryCatch = byPattern('try/catch');
    expect(tryCatch!.codeSnippet).toMatch(/^try \{/);

    const fetchCall = byPattern('fetch()');
    expect(fetchCall!.codeSnippet).toMatch(/^fetch\(/);

    const thrown = byPattern('throw');
    expect(thrown!.codeSnippet).toMatch(/^throw/);
  });

  it('points every opportunity at a line that actually exists in the source', () => {
    const lineCount = SRC.split('\n').length;
    for (const o of opps) {
      expect(o.line).toBeGreaterThanOrEqual(1);
      expect(o.line).toBeLessThanOrEqual(lineCount);
      expect(o.column).toBeGreaterThanOrEqual(1);
    }
  });
});
