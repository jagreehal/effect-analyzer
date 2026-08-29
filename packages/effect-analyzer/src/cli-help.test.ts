/**
 * `--help` is the only flag reference a terminal user has, and it is a hand
 * written literal in a different file from the parser. Nothing tied the two
 * together, so `cli.ts`'s decomposition could move the parser forward and
 * leave the help text behind without a single test failing. It did: seven
 * working flags went undocumented, including `--diff` and `--include-trivial`,
 * the latter recommended by the analyzer's own output.
 *
 * These tests read the parser's source and require every flag and every
 * accepted enum value to appear in the help text. A flag added to the parser
 * fails here until it is documented.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_TEXT } from './cli-help';

const parserSource = readFileSync(join(__dirname, 'cli-options.ts'), 'utf8');

const matchAll = (pattern: RegExp): readonly string[] => [
  ...new Set([...parserSource.matchAll(pattern)].map((m) => m[1]!)),
];

/** `arg === '--flag'` and `arg === '-f'`. */
const comparedFlags = matchAll(/arg === '(-{1,2}[a-z0-9-]+)'/g);
/** `arg.startsWith('--flag=')`, whose documented spelling omits the `=`. */
const prefixFlags = matchAll(/startsWith\('(--[a-z0-9-]+)='\)/g);

const ALL_FLAGS = [...new Set([...comparedFlags, ...prefixFlags])].sort();

/**
 * The `--format` branch is a chain of `value === '...'` comparisons. Reading it
 * from source keeps this test honest when a format is added.
 */
const formatBranch = parserSource.slice(
  parserSource.indexOf("arg === '--format'"),
  parserSource.indexOf("} else if (arg === '--export')"),
);
const ACCEPTED_FORMATS = [
  ...new Set([...formatBranch.matchAll(/value === '([a-z0-9-]+)'/g)].map((m) => m[1]!)),
].sort();

describe('--help', () => {
  it('finds the parser flags it is meant to describe', () => {
    // Guards the extraction itself: a regex that silently matches nothing
    // would make every assertion below vacuously true.
    expect(ALL_FLAGS.length).toBeGreaterThan(80);
    expect(ACCEPTED_FORMATS.length).toBeGreaterThan(30);
  });

  it.each(ALL_FLAGS)('documents %s', (flag) => {
    expect(HELP_TEXT).toContain(flag);
  });

  it.each(ACCEPTED_FORMATS)('lists --format %s', (format) => {
    const formatLine = HELP_TEXT.split('\n').find((l) => l.includes('Output format:'));
    expect(formatLine).toBeDefined();
    expect(formatLine).toContain(format);
  });
});
