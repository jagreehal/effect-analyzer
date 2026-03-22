/**
 * JSON output generation for Effect IR
 */

import { Effect } from 'effect';
import type { StaticEffectIR, JSONRenderOptions } from '../types';

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

  // Handle Option
  if (value && typeof value === 'object' && '_tag' in value) {
    // This is likely an Option
    return value;
  }

  return value;
};
