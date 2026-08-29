/**
 * An unrecognised enum value used to leave the option at its default and say
 * nothing. `--format nosuchformat` exited 0 and wrote the `auto` format, so a
 * typo in a CI pipeline produced the wrong artifact and passed.
 *
 * `parseArgs` stays pure and still leaves the option at its default, which is
 * what `REJECTS` in cli-options.test.ts pins. What is new is that it records
 * why, so the CLI can report the typo and exit non-zero instead of guessing.
 */
import { describe, expect, it } from 'vitest';
import { parseArgs } from './cli-options';

const errorsFor = (...args: readonly string[]) => parseArgs(args).errors;

describe('parseArgs invalid values', () => {
  it('reports nothing for a valid argv', () => {
    expect(errorsFor('src/a.ts', '--format', 'json', '--direction', 'LR')).toEqual([]);
  });

  it.each([
    ['--format', 'nosuchformat'],
    ['--direction', 'sideways'],
    ['--detail', 'loud'],
    ['--profile', 'lax'],
    ['--test-runner', 'ava'],
    ['--improve-min-priority', 'P9'],
  ])('reports %s %s', (flag, value) => {
    const errors = errorsFor(flag, value);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(flag);
    expect(errors[0]).toContain(value);
  });

  it.each([
    '--format',
    '--direction',
    '--detail',
    '--profile',
    '--test-runner',
    '--improve-min-priority',
  ])('reports a missing value for %s', (flag) => {
    const errors = errorsFor(flag);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`Missing value for ${flag}`);
  });

  it('reports the `--flag=value` spelling too', () => {
    const errors = errorsFor('--profile=lax');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('lax');
  });

  it('lists the accepted values so the message is actionable', () => {
    expect(errorsFor('--direction', 'sideways')[0]).toContain('TB');
  });

  it('points at --help instead of printing a wall for a long list', () => {
    // `--format` accepts 32 values. Spelling them out puts a paragraph on one
    // line and buries the typo it is supposed to highlight.
    const message = errorsFor('--format', 'nosuchformat')[0]!;
    expect(message).toContain('--help');
    expect(message).not.toContain('mermaid-testability');
    expect(message.length).toBeLessThan(120);
  });

  it('collects every bad value rather than stopping at the first', () => {
    expect(errorsFor('--format', 'nope', '--detail', 'loud')).toHaveLength(2);
  });

  it('still leaves the option at its default', () => {
    expect(parseArgs(['--format', 'nope']).options.format).toBe(
      parseArgs([]).options.format,
    );
  });
});
