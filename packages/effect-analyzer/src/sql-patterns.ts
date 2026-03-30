/**
 * SQL / Database Pattern Detection (GAP 15)
 *
 * Detects SqlClient, SqlSchema, transactions, and N+1 patterns.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface SqlPatternAnalysis {
  readonly sqlClientUsed: boolean;
  readonly withTransaction: boolean;
  readonly schemaDefs: string[];
  readonly queryInLoop: boolean;
  readonly locations: Map<string, SourceLocation>;
  readonly resolvers?: { name: string; table?: string; location: SourceLocation }[];
  readonly migrations?: { name: string; location: SourceLocation }[];
  readonly queriesInLoops?: { query: string; location: SourceLocation }[];
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
 * Analyze a file for Effect SQL/database patterns.
 */
export function analyzeSqlPatterns(
  filePath: string,
  source?: string,
): SqlPatternAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  let sqlClientUsed = false;
  let withTransaction = false;
  const schemaDefs: string[] = [];
  let queryInLoop = false;
  const resolvers: { name: string; table?: string; location: SourceLocation }[] = [];
  const migrations: { name: string; location: SourceLocation }[] = [];
  const queriesInLoops: { query: string; location: SourceLocation }[] = [];

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    const loc = getLoc(filePath, node, sf);
    if (expr.includes('SqlClient') || expr.includes('sqlClient') || expr.includes('Sql')) {
      sqlClientUsed = true;
      locations.set('sql', loc);
    }
    if (expr.includes('withTransaction')) {
      withTransaction = true;
      locations.set('transaction', loc);
    }
    if (expr.includes('SqlSchema') || expr.includes('sqlSchema')) {
      schemaDefs.push(expr.slice(0, 80));
      locations.set('schema', loc);
    }
    // SqlResolver extraction
    if (expr.includes('SqlResolver.make') || expr.includes('SqlResolver.grouped') || expr.includes('SqlResolver.void')) {
      const args = node.getArguments();
      const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'unnamed';
      resolvers.push({ name: nameArg ?? 'unnamed', location: loc });
    }
    // SqlMigrator extraction
    if (expr.includes('SqlMigrator')) {
      const args = node.getArguments();
      const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'unnamed';
      migrations.push({ name: nameArg ?? 'unnamed', location: loc });
    }
  }

  const loopKinds = [SyntaxKind.ForStatement, SyntaxKind.ForOfStatement, SyntaxKind.WhileStatement];
  for (const loopKind of loopKinds) {
    for (const loop of sf.getDescendantsOfKind(loopKind)) {
      const body = loop.getFirstChildByKind(SyntaxKind.Block);
      const text = body?.getText() ?? '';
      if (text.includes('Sql') || text.includes('execute') || text.includes('query')) {
        queryInLoop = true;
        const loopLoc = getLoc(filePath, loop, sf);
        locations.set('sql-in-loop', loopLoc);
        queriesInLoops.push({ query: text.slice(0, 80), location: loopLoc });
      }
    }
  }

  return {
    sqlClientUsed,
    withTransaction,
    schemaDefs: [...new Set(schemaDefs)],
    queryInLoop,
    locations,
    ...(resolvers.length > 0 ? { resolvers } : {}),
    ...(migrations.length > 0 ? { migrations } : {}),
    ...(queriesInLoops.length > 0 ? { queriesInLoops } : {}),
  };
}
