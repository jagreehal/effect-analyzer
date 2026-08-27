import { mkdtempSync, statSync } from 'node:fs';

import { join, sep } from 'node:path';
import { Effect, Exit } from 'effect';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { probeJsonSchema, probeRuntime, RuntimeProbeError } from './runtime-probe';

// `tsx` opens a unix socket under TMPDIR, and the socket path limit is ~104
// bytes. The repo's vitest setup points TMPDIR at a long repo-local path, so
// the probe's child needs a short one for the duration of this file.
const shortTmp = mkdtempSync(join(sep, 'tmp', 'effect-analyzer-probe-'));
const originalTmp = { TMPDIR: process.env['TMPDIR'], TMP: process.env['TMP'] };

beforeAll(() => {
  process.env['TMPDIR'] = shortTmp;
  process.env['TMP'] = shortTmp;
});

afterAll(() => {
  process.env['TMPDIR'] = originalTmp.TMPDIR;
  process.env['TMP'] = originalTmp.TMP;
});

const repoRoot = join(__dirname, '..', '..', '..');
const fixture = join(__dirname, '__fixtures__', 'runtime-schema.ts');
const opts = { cwd: repoRoot, timeoutMs: 60_000 };

vi.setConfig({ testTimeout: 120_000 });

/** The `reason` a failed probe carried, or a marker if it did not fail. */
const reasonOf = (exit: Exit.Exit<unknown, RuntimeProbeError>): string => {
  if (!Exit.isFailure(exit)) return '(probe succeeded)';
  const serialized = JSON.stringify(exit);
  const match = /"reason":("(?:[^"\\]|\\.)*")/.exec(serialized);
  return match?.[1] === undefined ? serialized : (JSON.parse(match[1]) as string);
};

describe('probeRuntime', () => {
  it('lists a module’s exports', async () => {
    const names = await Effect.runPromise(
      probeRuntime(fixture, { kind: 'exports' }, opts),
    );
    expect(names).toEqual(expect.arrayContaining(['User']));
  });

  it('returns a typed failure for a module that cannot be imported', async () => {
    const exit = await Effect.runPromiseExit(
      probeRuntime(join(__dirname, '__fixtures__', 'does-not-exist.ts'), { kind: 'exports' }, opts),
    );
    expect(reasonOf(exit)).toContain('Could not import');
  });

  // The three things the module promises isolation from. Each is a real child
  // process doing the hostile thing; the probe has to come back with a reason.
  it('survives a module that throws while initializing', async () => {
    const exit = await Effect.runPromiseExit(
      probeRuntime(join(__dirname, '__fixtures__', 'probe-throws.ts'), { kind: 'exports' }, opts),
    );
    expect(reasonOf(exit)).toContain('module initialization blew up');
  });

  it('survives a module that calls process.exit while initializing', async () => {
    const exit = await Effect.runPromiseExit(
      probeRuntime(join(__dirname, '__fixtures__', 'probe-exits.ts'), { kind: 'exports' }, opts),
    );
    expect(reasonOf(exit)).toContain('Probe produced no output (exit 3)');
  });

  it('kills a module that hangs, and says it timed out', async () => {
    const exit = await Effect.runPromiseExit(
      probeRuntime(join(__dirname, '__fixtures__', 'probe-hangs.ts'), { kind: 'exports' }, {
        ...opts,
        timeoutMs: 5_000,
      }),
    );
    expect(reasonOf(exit)).toBe('Probe timed out');
  });

  // The probe must not depend on `npx` locating a loader at run time. A clean
  // or offline consumer install has no npx cache to hit, and an online one
  // would fetch and execute whatever `tsx@latest` happens to be that day.
  // Emptying PATH is how we prove the loader comes from this package's own
  // pinned dependencies instead.
  it('probes with nothing on PATH', async () => {
    const originalPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      const names = await Effect.runPromise(
        probeRuntime(fixture, { kind: 'exports' }, opts),
      );
      expect(names).toEqual(expect.arrayContaining(['User']));
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  // A timeout that only reports a timeout is not isolation. `tsx` re-spawns
  // node to install its loaders, so the probed module is a *grandchild*:
  // killing the direct child leaves it running, still holding the pipes and
  // still burning a core. The heartbeat is how we observe that from outside.
  it('kills the probed module itself, not just the process it spawned', async () => {
    const heartbeat = join(shortTmp, 'heartbeat.txt');
    process.env['PROBE_HEARTBEAT_FILE'] = heartbeat;
    try {
      const exit = await Effect.runPromiseExit(
        probeRuntime(join(__dirname, '__fixtures__', 'probe-hangs.ts'), { kind: 'exports' }, {
          ...opts,
          timeoutMs: 5_000,
        }),
      );
      expect(reasonOf(exit)).toBe('Probe timed out');

      // Guards the guard: without this the assertion below would pass just as
      // happily if the fixture had never started.
      const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 750));
      await settle();
      const afterKill = statSync(heartbeat).size;
      expect(afterKill).toBeGreaterThan(0);

      await settle();
      expect(statSync(heartbeat).size).toBe(afterKill);
    } finally {
      delete process.env['PROBE_HEARTBEAT_FILE'];
    }
  });

  it('reports an unknown probe kind rather than answering it', async () => {
    const exit = await Effect.runPromiseExit(
      probeRuntime(fixture, { kind: 'nonsense' } as never, opts),
    );
    expect(reasonOf(exit)).toContain('Unknown probe kind: nonsense');
  });
});

describe('probeJsonSchema', () => {
  it('rejects probe output that is not a JSON Schema document', async () => {
    const exit = await Effect.runPromiseExit(probeJsonSchema(fixture, 'notASchema', opts));
    expect(reasonOf(exit)).toContain('No export "notASchema"');
  });

  it('returns the exact schema Effect itself produces', async () => {
    const doc = await Effect.runPromise(probeJsonSchema(fixture, 'User', opts));
    expect(doc.dialect).toBe('draft-2020-12');
    const schema = doc.schema as unknown as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required: readonly string[];
    };

    // The shape the static walker got wrong: a struct whose field is an array.
    expect(schema.type).toBe('object');
    expect(schema.properties['tags']).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'age', 'tags']));

    // And the refinement the static walker cannot see at all. Effect has
    // represented a check inline on the property in some versions and nested
    // under `allOf` in others, so assert the constraint survived rather than
    // the shape it arrived in — the point is that the probe sees a bound the
    // AST never could.
    expect(schema.properties['name']).toMatchObject({ type: 'string' });
    expect(JSON.stringify(schema.properties['name'])).toContain('"minLength":2');
  });

  it('fails with a typed error when the export is not a Schema', async () => {
    const exit = await Effect.runPromiseExit(probeJsonSchema(fixture, 'Nope', opts));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain('RuntimeProbeError');
    expect(reasonOf(exit)).toContain('No export "Nope"');
  });

  it('names the file it was probing on every failure', async () => {
    const exit = await Effect.runPromiseExit(probeJsonSchema(fixture, 'Nope', opts));
    const error = Exit.isFailure(exit) ? (exit.cause as unknown as { error: RuntimeProbeError }) : undefined;
    expect(JSON.stringify(error)).toContain(fixture);
  });
});
