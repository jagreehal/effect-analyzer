/**
 * Request Batching / DataLoader Pattern (GAP 19)
 *
 * Detects RequestResolver, Request.tagged, Effect.withRequestBatching.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface RequestBatchingAnalysis {
  readonly requestTagged: boolean;
  readonly resolverBatched: boolean;
  readonly withBatching: boolean;
  readonly withCaching: boolean;
  readonly locations: Map<string, SourceLocation>;
}

function getLoc(
  filePath: string,
  node: { getStart: () => number },
  sf: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { filePath, line: line + 1, column };
}

/**
 * Analyze a file for Effect request batching patterns.
 */
export function analyzeRequestBatching(
  filePath: string,
  source?: string,
): RequestBatchingAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  let requestTagged = false;
  let resolverBatched = false;
  let withBatching = false;
  let withCaching = false;

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    const loc = getLoc(filePath, node, sf);
    if (expr.includes('Request.tagged') || expr.includes('Request.of')) {
      requestTagged = true;
      locations.set('request', loc);
    }
    if (expr.includes('RequestResolver.makeBatched') || expr.includes('RequestResolver.fromEffect')) {
      resolverBatched = true;
      locations.set('resolver', loc);
    }
    if (expr.includes('withRequestBatching')) {
      withBatching = true;
      locations.set('batching', loc);
    }
    if (expr.includes('withRequestCaching')) {
      withCaching = true;
      locations.set('caching', loc);
    }
  }

  return {
    requestTagged,
    resolverBatched,
    withBatching,
    withCaching,
    locations,
  };
}
