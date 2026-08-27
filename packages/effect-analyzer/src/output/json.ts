/**
 * JSON output generation for Effect IR
 */

import { Effect } from 'effect';
import type { StaticEffectIR, JSONRenderOptions } from '../types';

/**
 * Version of the emitted IR document.
 *
 * Stamped on every JSON document so a consumer can validate what it received
 * and migrate across analyzer releases instead of guessing from the shape.
 * Bump it whenever the emitted structure changes incompatibly.
 */
export const IR_SCHEMA_VERSION = 1 as const;

const DEFAULT_OPTIONS: JSONRenderOptions = {
  pretty: true,
  includeMetadata: true,
  compact: false,
};

/**
 * Render Effect IR as JSON string
 */
export const renderJSON = (
  ir: StaticEffectIR,
  options?: Partial<JSONRenderOptions>,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const space = opts.pretty ? 2 : undefined;

    const data = opts.includeMetadata
      ? {
          schemaVersion: IR_SCHEMA_VERSION,
          root: ir.root,
          metadata: ir.metadata,
          references:
            ir.references instanceof Map
              ? Object.fromEntries(ir.references)
              : ir.references,
        }
      : { root: ir.root };

    return JSON.stringify(data, replacer, space);
  });

/**
 * Render multiple Effect IRs as JSON array
 */
export const renderMultipleJSON = (
  irs: readonly StaticEffectIR[],
  options?: Partial<JSONRenderOptions>,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const space = opts.pretty ? 2 : undefined;

    const data = irs.map((ir) =>
      opts.includeMetadata
        ? {
            schemaVersion: IR_SCHEMA_VERSION,
            root: ir.root,
            metadata: ir.metadata,
            references:
              ir.references instanceof Map
                ? Object.fromEntries(ir.references)
                : ir.references,
          }
        : { root: ir.root },
    );

    return JSON.stringify(data, replacer, space);
  });

/**
 * JSON replacer to handle circular references and special types
 */
const replacer = (_key: string, value: unknown): unknown => {
  // Handle Map
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }

  // Handle Set
  if (value instanceof Set) {
    return Array.from(value);
  }

  // Handle BigInt
  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
};
