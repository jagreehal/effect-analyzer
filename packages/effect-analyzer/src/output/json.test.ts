import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { renderJSON, renderMultipleJSON, IR_SCHEMA_VERSION } from './json';
import type { StaticEffectIR } from '../types';

const ir = (): StaticEffectIR =>
  ({
    root: { id: 'p1', type: 'program', programName: 'w', source: 'generator', children: [] },
    metadata: { analyzedAt: 0, filePath: 'a.ts', stats: {} },
    references: new Map(),
  }) as unknown as StaticEffectIR;

const parse = async (effect: Effect.Effect<string>): Promise<unknown> =>
  JSON.parse(await Effect.runPromise(effect));

describe('renderJSON', () => {
  it('stamps the IR schema version so consumers can validate and migrate', async () => {
    expect(await parse(renderJSON(ir()))).toMatchObject({
      schemaVersion: IR_SCHEMA_VERSION,
    });
  });

  // Additive only: the multi-program document stays a bare array so existing
  // consumers keep working; each entry carries the version.
  it('stamps the version on every entry of a multi-program document', async () => {
    const parsed = (await parse(renderMultipleJSON([ir(), ir()]))) as readonly Record<
      string,
      unknown
    >[];
    expect(parsed).toHaveLength(2);
    for (const entry of parsed) {
      expect(entry).toMatchObject({ schemaVersion: IR_SCHEMA_VERSION });
    }
  });

  it('omits the version when metadata is excluded', async () => {
    expect(await parse(renderJSON(ir(), { includeMetadata: false }))).not.toHaveProperty(
      'schemaVersion',
    );
  });

  it('keeps the program itself when metadata is excluded', async () => {
    const bare = { root: ir().root };
    expect(await parse(renderJSON(ir(), { includeMetadata: false }))).toEqual(bare);
    expect(await parse(renderMultipleJSON([ir()], { includeMetadata: false }))).toEqual([bare]);
  });

  it('indents by default and stops when pretty is off', async () => {
    expect(await Effect.runPromise(renderJSON(ir()))).toContain('\n  ');
    expect(await Effect.runPromise(renderJSON(ir(), { pretty: false }))).not.toContain('\n');
    expect(await Effect.runPromise(renderMultipleJSON([ir()]))).toContain('\n  ');
    expect(await Effect.runPromise(renderMultipleJSON([ir()], { pretty: false }))).not.toContain(
      '\n',
    );
  });

  // The replacer exists because JSON.stringify turns these into `{}` or throws.
  it('serializes the values JSON.stringify cannot', async () => {
    const withOddValues = {
      ...ir(),
      root: {
        ...ir().root,
        seen: new Map([['a', 1]]),
        tags: new Set(['x', 'y']),
        size: 9007199254740993n,
      },
    } as unknown as StaticEffectIR;
    expect(await parse(renderJSON(withOddValues))).toMatchObject({
      root: { seen: { a: 1 }, tags: ['x', 'y'], size: '9007199254740993' },
    });
  });
});
