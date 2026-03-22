/**
 * Fiber Lifecycle Analysis
 *
 * Detects fiber fork patterns and potential leaks:
 * - Unscoped forks (Effect.fork) without a corresponding join/await/interrupt
 * - Daemon forks (fire-and-forget) flagged as intentional
 * - Scoped forks (forkScoped) always safe within scope
 */

import type { StaticEffectIR, StaticFlowNode, StaticFiberNode } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export type FiberRisk = 'safe' | 'daemon' | 'potential-leak' | 'uncertain';

export interface FiberForkInfo {
  /** Node ID of the fork */
  nodeId: string;
  /** Fork variant */
  operation: StaticFiberNode['operation'];
  /** Whether this fork is scoped (forkScoped) */
  isScoped: boolean;
  /** Whether this fork is daemon (forkDaemon) — fire-and-forget intentional */
  isDaemon: boolean;
  /** Whether a join/await/interrupt is found in the same program tree */
  hasJoin: boolean;
  /** Risk classification */
  risk: FiberRisk;
  location?: { filePath: string; line: number; column: number };
}

export interface FiberLeakAnalysis {
  /** All fork operations found */
  forks: FiberForkInfo[];
  /** Forks classified as potential leaks (unscoped, non-daemon, no join) */
  potentialLeaks: FiberForkInfo[];
  /** Daemon (fire-and-forget) forks */
  daemonForks: FiberForkInfo[];
  /** Safely scoped forks */
  safeForks: FiberForkInfo[];
  /** Summary counts */
  summary: {
    total: number;
    safe: number;
    daemon: number;
    potentialLeaks: number;
    uncertain: number;
  };
}

// =============================================================================
// Collection
// =============================================================================

type JoinSet = Set<string>;

function collectForks(
  nodes: readonly StaticFlowNode[],
  forks: StaticFiberNode[],
  joinIds: JoinSet,
): void {
  for (const node of nodes) {
    if (node.type === 'fiber') {
      const fiber = node;
      if (
        fiber.operation === 'fork' ||
        fiber.operation === 'forkScoped' ||
        fiber.operation === 'forkDaemon' ||
        fiber.operation === 'forkAll' ||
        fiber.operation === 'forkIn' ||
        fiber.operation === 'forkWithErrorHandler'
      ) {
        forks.push(fiber);
      }
      if (
        fiber.operation === 'join' ||
        fiber.operation === 'await' ||
        fiber.operation === 'awaitAll' ||
        fiber.operation === 'interrupt' ||
        fiber.operation === 'interruptFork'
      ) {
        if (fiber.joinPoint) joinIds.add(fiber.joinPoint);
        joinIds.add(fiber.id);
      }
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) collectForks(children, forks, joinIds);
  }
}

function classifyFork(fork: StaticFiberNode, hasJoin: boolean): FiberRisk {
  if (fork.isScoped) return 'safe';
  if (fork.isDaemon) return 'daemon';
  if (hasJoin) return 'safe';
  if (fork.operation === 'forkAll') return 'uncertain';
  if (fork.operation === 'forkIn') return 'safe'; // supervised by parent scope
  return 'potential-leak';
}

// =============================================================================
// Analysis
// =============================================================================

export function analyzeFiberLeaks(ir: StaticEffectIR): FiberLeakAnalysis {
  const rawForks: StaticFiberNode[] = [];
  const joinIds: JoinSet = new Set();

  collectForks(ir.root.children, rawForks, joinIds);

  const forks: FiberForkInfo[] = rawForks.map((fork) => {
    // A join is "associated" if there's a joinPoint referencing this fork,
    // or if any join node appears in the same program tree (conservative heuristic)
    const hasJoin = joinIds.size > 0;
    const risk = classifyFork(fork, hasJoin);

    const info: FiberForkInfo = {
      nodeId: fork.id,
      operation: fork.operation,
      isScoped: fork.isScoped,
      isDaemon: fork.isDaemon,
      hasJoin,
      risk,
    };
    if (fork.location) info.location = fork.location;
    return info;
  });

  const potentialLeaks = forks.filter((f) => f.risk === 'potential-leak');
  const daemonForks = forks.filter((f) => f.risk === 'daemon');
  const safeForks = forks.filter((f) => f.risk === 'safe');
  const uncertain = forks.filter((f) => f.risk === 'uncertain');

  return {
    forks,
    potentialLeaks,
    daemonForks,
    safeForks,
    summary: {
      total: forks.length,
      safe: safeForks.length,
      daemon: daemonForks.length,
      potentialLeaks: potentialLeaks.length,
      uncertain: uncertain.length,
    },
  };
}

// =============================================================================
// Formatting
// =============================================================================

export function formatFiberLeakReport(analysis: FiberLeakAnalysis): string {
  const lines: string[] = [];
  lines.push('# Fiber Lifecycle Analysis');
  lines.push('');
  lines.push(`Total forks: ${analysis.summary.total}`);
  lines.push(`  Safe (scoped/joined): ${analysis.summary.safe}`);
  lines.push(`  Daemon (intentional): ${analysis.summary.daemon}`);
  lines.push(`  Uncertain: ${analysis.summary.uncertain}`);
  lines.push(`  Potential leaks: ${analysis.summary.potentialLeaks}`);

  if (analysis.potentialLeaks.length > 0) {
    lines.push('');
    lines.push('## ⚠️ Potential Fiber Leaks');
    lines.push('');
    lines.push('These forks are not scoped, not daemon, and no join/await was found in the same program:');
    lines.push('');
    for (const leak of analysis.potentialLeaks) {
      const loc = leak.location
        ? ` at ${leak.location.filePath}:${leak.location.line}`
        : '';
      lines.push(`- \`${leak.operation}\` (id: ${leak.nodeId})${loc}`);
    }
    lines.push('');
    lines.push('💡 **Suggestions**:');
    lines.push('  - Use `Effect.forkScoped` to tie fiber lifetime to a scope');
    lines.push('  - Use `Effect.forkDaemon` if fire-and-forget is intentional');
    lines.push('  - Add `Fiber.join(fiber)` / `Fiber.await(fiber)` to properly await the fiber');
  }

  if (analysis.daemonForks.length > 0) {
    lines.push('');
    lines.push('## ℹ️ Daemon Forks (fire-and-forget)');
    lines.push('');
    for (const df of analysis.daemonForks) {
      const loc = df.location
        ? ` at ${df.location.filePath}:${df.location.line}`
        : '';
      lines.push(`- \`${df.operation}\` (id: ${df.nodeId})${loc}`);
    }
  }

  return lines.join('\n');
}
