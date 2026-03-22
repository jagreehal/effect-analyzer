/**
 * STM (Software Transactional Memory) Analysis (GAP 13)
 *
 * Detects STM.commit, TRef, TMap, TQueue, transactional refs.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface StmAnalysis {
  readonly commitSites: SourceLocation[];
  readonly tRefs: string[];
  readonly tMaps: string[];
  readonly tQueues: string[];
  readonly retryUsed: boolean;
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
 * Analyze a file for Effect STM usage.
 */
export function analyzeStm(
  filePath: string,
  source?: string,
): StmAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  const commitSites: SourceLocation[] = [];
  const tRefs: string[] = [];
  const tMaps: string[] = [];
  const tQueues: string[] = [];
  let retryUsed = false;

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    const loc = getLoc(filePath, node, sf);
    if (expr.includes('STM.commit') || expr === 'STM.commit') {
      commitSites.push(loc);
      locations.set('commit', loc);
    }
    if (expr.includes('TRef.make') || expr.includes('TRef.unsafeMake')) {
      tRefs.push(expr.slice(0, 50));
      locations.set('tref', loc);
    }
    if (expr.includes('TMap.make') || expr.includes('TMap.empty')) {
      tMaps.push(expr.slice(0, 50));
      locations.set('tmap', loc);
    }
    if (expr.includes('TQueue.make') || expr.includes('TQueue.bounded')) {
      tQueues.push(expr.slice(0, 50));
      locations.set('tqueue', loc);
    }
    if (expr.includes('STM.retry') || expr === 'STM.retry') retryUsed = true;
  }

  return {
    commitSites,
    tRefs: [...new Set(tRefs)],
    tMaps: [...new Set(tMaps)],
    tQueues: [...new Set(tQueues)],
    retryUsed,
    locations,
  };
}
