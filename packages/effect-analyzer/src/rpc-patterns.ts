/**
 * RPC Pattern Detection (GAP 20)
 *
 * Detects @effect/rpc usage: Rpc.make, routers, client calls.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface RpcPatternAnalysis {
  readonly rpcDefined: boolean;
  readonly routers: string[];
  readonly clientCalls: string[];
  readonly locations: Map<string, SourceLocation>;
  readonly rpcDefinitions?: { name: string; isStreaming: boolean; location: SourceLocation }[];
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
 * Analyze a file for Effect RPC patterns.
 */
export function analyzeRpcPatterns(
  filePath: string,
  source?: string,
): RpcPatternAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  let rpcDefined = false;
  const routers: string[] = [];
  const clientCalls: string[] = [];
  const rpcDefinitions: { name: string; isStreaming: boolean; location: SourceLocation }[] = [];

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    const loc = getLoc(filePath, node, sf);
    if (expr.includes('Rpc.make') || expr.includes('Rpc.router')) {
      rpcDefined = true;
      routers.push(expr.slice(0, 60));
      locations.set('rpc', loc);
    }
    if (expr.includes('RpcClient') || expr.includes('Rpc.call')) {
      clientCalls.push(expr.slice(0, 60));
      locations.set('rpc-client', loc);
    }
    // RPC definition detection with streaming
    if (expr.includes('Rpc.make') || expr.includes('RpcGroup')) {
      const args = node.getArguments();
      const nameArg = args.length > 0 ? args[0]?.getText().replace(/["'`]/g, '') : 'unnamed';
      const nodeText = node.getText();
      const isStreaming = nodeText.includes('Stream') || nodeText.includes('stream');
      rpcDefinitions.push({ name: nameArg ?? 'unnamed', isStreaming, location: loc });
    }
  }

  return {
    rpcDefined,
    routers: [...new Set(routers)],
    clientCalls: [...new Set(clientCalls)],
    locations,
    ...(rpcDefinitions.length > 0 ? { rpcDefinitions } : {}),
  };
}
