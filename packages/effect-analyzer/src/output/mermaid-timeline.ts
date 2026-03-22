import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode } from '../types';
import { DEFAULT_LABEL_MAX, truncateDisplayText } from '../analysis-utils';

interface TimelineStep {
  readonly kind: 'service-call' | 'effect-constructor' | 'retry' | 'timeout' | 'parallel';
  readonly node: StaticFlowNode;
}

/** Collect steps in execution order from an IR tree. */
function collectSteps(nodes: readonly StaticFlowNode[]): readonly TimelineStep[] {
  const steps: TimelineStep[] = [];

  const visit = (node: StaticFlowNode): void => {
    if (node.type === 'parallel') {
      steps.push({ kind: 'parallel', node });
      return;
    }

    if (node.type === 'retry') {
      steps.push({ kind: 'retry', node });
      // Also visit the source effect inside the retry
      visit(node.source);
      return;
    }

    if (node.type === 'timeout') {
      steps.push({ kind: 'timeout', node });
      visit(node.source);
      return;
    }

    if (node.type === 'effect') {
      const callee = node.callee;
      // Skip noise: Effect.fn definitions, anonymous constructors, Schema/Data
      if (callee === 'Effect.fn' || callee.startsWith('Effect.fn(')) return;
      if (callee.startsWith('Schema.') || callee.startsWith('Data.')) return;
      const displayName = node.displayName ?? '';
      const hasExplicitName = displayName && displayName !== callee && displayName !== node.type;
      if (!hasExplicitName && (callee.startsWith('Effect.') || callee === 'Effect')) return;

      if (node.serviceCall) {
        steps.push({ kind: 'service-call', node });
      } else {
        steps.push({ kind: 'effect-constructor', node });
      }
      return;
    }

    // For structural nodes (generator, pipe, error-handler, etc.), recurse into children
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    for (const child of children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return steps;
}

/** Collect all unique service types from steps. */
function collectParticipants(steps: readonly TimelineStep[]): readonly string[] {
  const seen = new Set<string>();
  const participants: string[] = [];

  const visitStep = (step: TimelineStep): void => {
    if (step.kind === 'service-call' && step.node.type === 'effect' && step.node.serviceCall) {
      const svc = step.node.serviceCall.serviceType;
      if (!seen.has(svc)) {
        seen.add(svc);
        participants.push(svc);
      }
    } else if (step.kind === 'parallel') {
      // Look into parallel children for service calls
      const children = Option.getOrElse(getStaticChildren(step.node), () => []);
      for (const child of children) {
        if (child.type === 'effect' && child.serviceCall) {
          const svc = child.serviceCall.serviceType;
          if (!seen.has(svc)) {
            seen.add(svc);
            participants.push(svc);
          }
        }
      }
    }
  };

  for (const step of steps) {
    visitStep(step);
  }

  return participants;
}

/** Render a parallel node as par/and/end block. */
function renderParallelBlock(node: StaticFlowNode, lines: string[], indent: string): void {
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  if (children.length === 0) return;

  lines.push(`${indent}par Parallel`);
  for (let i = 0; i < children.length; i++) {
    if (i > 0) {
      lines.push(`${indent}and`);
    }
    const child = children[i];
    if (!child) continue;
    if (child.type === 'effect' && child.serviceCall) {
      lines.push(`${indent}  Program->>${child.serviceCall.serviceType}: ${child.serviceCall.methodName}()`);
      lines.push(`${indent}  ${child.serviceCall.serviceType}-->>Program: result`);
    } else if (child.type === 'effect') {
      lines.push(
        `${indent}  Note over Program: ${truncateDisplayText(child.callee, DEFAULT_LABEL_MAX)}`,
      );
    } else {
      const rawLabel =
        child.displayName ?? child.name ?? (typeof child.type === 'string' ? child.type : 'node');
      const label = truncateDisplayText(rawLabel, DEFAULT_LABEL_MAX);
      lines.push(`${indent}  Note over Program: ${label}`);
    }
  }
  lines.push(`${indent}end`);
}

/**
 * Render a Mermaid sequence diagram from an Effect IR showing
 * execution order with service calls and timing info.
 */
export function renderTimelineMermaid(ir: StaticEffectIR): string {
  const steps = collectSteps(ir.root.children);

  if (steps.length === 0) {
    return 'sequenceDiagram\n  participant Program\n  Note over Program: Empty program';
  }

  const participants = collectParticipants(steps);
  const lines: string[] = ['sequenceDiagram'];
  lines.push('  participant Program');
  for (const p of participants) {
    lines.push(`  participant ${p}`);
  }

  for (const step of steps) {
    switch (step.kind) {
      case 'service-call': {
        const node = step.node;
        if (node.type === 'effect' && node.serviceCall) {
          const svc = node.serviceCall.serviceType;
          const method = node.serviceCall.methodName;
          lines.push(`  Program->>${svc}: ${method}()`);
          lines.push(`  ${svc}-->>Program: result`);
        }
        break;
      }
      case 'effect-constructor': {
        const node = step.node;
        if (node.type === 'effect') {
          lines.push(
            `  Note over Program: ${truncateDisplayText(node.callee, DEFAULT_LABEL_MAX)}`,
          );
        }
        break;
      }
      case 'retry': {
        const node = step.node;
        if (node.type === 'retry') {
          const info = node.scheduleInfo;
          if (info) {
            const retries = info.maxRetries !== undefined ? `${info.maxRetries}x` : 'unlimited';
            lines.push(
              `  Note over Program: ${truncateDisplayText(`retry (${retries}, ${info.baseStrategy})`, DEFAULT_LABEL_MAX)}`,
            );
          } else if (node.schedule) {
            lines.push(
              `  Note over Program: ${truncateDisplayText(`retry (${node.schedule})`, DEFAULT_LABEL_MAX)}`,
            );
          } else {
            lines.push(`  Note over Program: retry`);
          }
        }
        break;
      }
      case 'timeout': {
        const node = step.node;
        if (node.type === 'timeout') {
          const dur = node.duration ?? 'unknown';
          lines.push(`  Note over Program: timeout(${dur})`);
        }
        break;
      }
      case 'parallel': {
        renderParallelBlock(step.node, lines, '  ');
        break;
      }
    }
  }

  return lines.join('\n');
}
