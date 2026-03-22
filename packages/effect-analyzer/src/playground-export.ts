/**
 * Effect Playground / REPL Integration (GAP 30 - minimal)
 *
 * Serializes IR + metadata for shareable or client-side exploration.
 */

import type { StaticEffectIR } from './types';
import { renderStaticMermaid } from './output/mermaid';

// =============================================================================
// Types
// =============================================================================

export interface PlaygroundPayload {
  readonly version: 1;
  readonly ir: StaticEffectIR;
  readonly mermaid: string;
  readonly programName: string;
  readonly exportedAt: string;
}

/**
 * Export IR and Mermaid as a JSON payload for sharing or embedding.
 */
export function exportForPlayground(ir: StaticEffectIR): PlaygroundPayload {
  const mermaid = renderStaticMermaid(ir);
  return {
    version: 1,
    ir,
    mermaid,
    programName: ir.root.programName,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Encode payload as a base64 JSON string (for URL-safe sharing).
 */
export function encodePlaygroundPayload(payload: PlaygroundPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
}

/**
 * Decode a base64url string back to PlaygroundPayload.
 */
export function decodePlaygroundPayload(encoded: string): PlaygroundPayload {
  const json = Buffer.from(encoded, 'base64url').toString('utf-8');
  return JSON.parse(json) as PlaygroundPayload;
}
