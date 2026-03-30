/**
 * Pattern Matching (Match) Analysis (GAP 12)
 *
 * Detects Effect Match module usage and non-exhaustive matches.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface MatchArmInfo {
  readonly kind: 'tag' | 'when' | 'not' | 'orElse' | 'exhaustive';
  readonly tag?: string;
  readonly location?: SourceLocation;
}

export interface MatchAnalysis {
  readonly matchSites: MatchSiteInfo[];
  readonly nonExhaustive: MatchSiteInfo[];
}

export interface MatchSiteInfo {
  readonly location?: SourceLocation;
  readonly arms: MatchArmInfo[];
  readonly hasExhaustive: boolean;
  readonly hasOrElse: boolean;
}

function getLoc(
  filePath: string,
  node: { getStart: () => number },
  sf: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line: line + 1, column, offset };
}

/**
 * Analyze a file for Effect Match usage.
 */
export function analyzeMatch(filePath: string, source?: string): MatchAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source ? project.createSourceFile(filePath, source) : project.addSourceFileAtPath(filePath);
  const matchSites: MatchSiteInfo[] = [];
  const nonExhaustive: MatchSiteInfo[] = [];

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    if (!text.includes('Match')) continue;
    if (text.includes('Match.type') || text.includes('Match.tag') || text.includes('Match.value')) {
      const chain = node.getParent();
      const full = chain?.getText() ?? '';
      const arms: MatchArmInfo[] = [];
      const hasExhaustive = full.includes('.exhaustive(');
      const hasOrElse = full.includes('.orElse(');
      if (full.includes('Match.tag(')) {
        const tagMatch = /Match\.tag\s*\(\s*["'](\w+)["']/.exec(full);
        if (tagMatch) {
          const tag = tagMatch[1];
          const arm: MatchArmInfo = tag !== undefined
            ? { kind: 'tag', tag, location: getLoc(filePath, node, sf) }
            : { kind: 'tag', location: getLoc(filePath, node, sf) };
          arms.push(arm);
        }
      }
      if (hasExhaustive) arms.push({ kind: 'exhaustive' });
      if (hasOrElse) arms.push({ kind: 'orElse' });
      const site: MatchSiteInfo = {
        location: getLoc(filePath, node, sf),
        arms,
        hasExhaustive,
        hasOrElse,
      };
      matchSites.push(site);
      if (!hasExhaustive && !hasOrElse) nonExhaustive.push(site);
    }
  }

  return { matchSites, nonExhaustive };
}
