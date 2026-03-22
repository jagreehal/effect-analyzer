import { Option } from 'effect';
import { getStaticChildren, type StaticEffectIR, type StaticFlowNode, type StaticRetryNode, type StaticTimeoutNode } from '../types';

interface RetryOptions {
  readonly direction?: 'TB' | 'LR' | 'BT' | 'RL';
}

interface ResilienceNode {
  readonly node: StaticFlowNode;
  readonly index: number;
}

/** Escape characters that break Mermaid label syntax. */
function escapeLabel(text: string): string {
  return text
    .replace(/"/g, '#quot;')
    .replace(/</g, '#lt;')
    .replace(/>/g, '#gt;')
    .replace(/\(/g, '#lpar;')
    .replace(/\)/g, '#rpar;');
}

/** Recursively collect retry and timeout nodes from the IR. */
function collectResilienceNodes(
  nodes: readonly StaticFlowNode[],
  result: ResilienceNode[],
): void {
  for (const node of nodes) {
    if (node.type === 'retry' || node.type === 'timeout') {
      result.push({ node, index: result.length });
    }
    const children = Option.getOrElse(getStaticChildren(node), () => []);
    if (children.length > 0) collectResilienceNodes(children, result);
  }
}

/** Build a retry strategy label from scheduleInfo. */
function buildRetryLabel(node: StaticFlowNode): string {
  if (node.type !== 'retry') return '';
  const info = (node).scheduleInfo;
  if (!info) return 'retry';

  const parts: string[] = [info.baseStrategy];
  if (info.maxRetries !== undefined && info.maxRetries !== 'unlimited') {
    parts.push(`${info.maxRetries}x`);
  }
  if (info.initialDelay) {
    parts.push(info.initialDelay);
  }
  if (info.maxDelay) {
    parts.push(`max ${info.maxDelay}`);
  }
  if (info.jittered) {
    parts.push('+jitter');
  }
  return parts.join(' ');
}

/** Compute display name for the operation being retried/timed-out. */
function operationLabel(node: StaticFlowNode): string {
  const source = (node as StaticRetryNode | StaticTimeoutNode).source as
    | StaticFlowNode
    | undefined;
  if (source === undefined) return 'Operation';
  if (source.displayName) return source.displayName;
  if (source.name) return source.name;
  return 'Operation';
}

/**
 * Render a Mermaid flowchart showing retry and timeout resilience patterns.
 */
export function renderRetryMermaid(
  ir: StaticEffectIR,
  options: RetryOptions = {},
): string {
  const direction = options.direction ?? 'LR';
  const collected: ResilienceNode[] = [];
  collectResilienceNodes(ir.root.children, collected);

  if (collected.length === 0) {
    return `flowchart ${direction}\n  NoRetry((No retry/timeout patterns))`;
  }

  const lines: string[] = [`flowchart ${direction}`];

  for (const { node, index } of collected) {
    const prefix = `N${index}`;
    const opLabel = escapeLabel(operationLabel(node));

    if (node.type === 'retry') {
      const retryNode = node;
      const retryLabel = escapeLabel(buildRetryLabel(node));

      lines.push(`  ${prefix}_Op[${opLabel}] -->|fail| ${prefix}_R{Retry}`);
      lines.push(`  ${prefix}_R -->|"${retryLabel}"| ${prefix}_Op`);

      if (retryNode.hasFallback) {
        lines.push(`  ${prefix}_R -->|exhausted| ${prefix}_F[Fallback]`);
      } else {
        lines.push(`  ${prefix}_R -->|exhausted| ${prefix}_Fail((Failure))`);
      }

      // Styles
      lines.push(`  style ${prefix}_R fill:#9b59b6,stroke:#8e44ad,color:#fff`);
      if (retryNode.hasFallback) {
        lines.push(`  style ${prefix}_F fill:#2ecc71,stroke:#27ae60,color:#fff`);
      } else {
        lines.push(`  style ${prefix}_Fail fill:#e74c3c,stroke:#c0392b,color:#fff`);
      }
    } else if (node.type === 'timeout') {
      const timeoutNode = node;
      const duration = timeoutNode.duration ?? '?';
      const timeoutLabel = escapeLabel(`timeout: ${duration}ms`);

      lines.push(`  ${prefix}_Op[${opLabel}] -->|within| ${prefix}_T[${timeoutLabel}]`);

      if (timeoutNode.hasFallback) {
        lines.push(`  ${prefix}_T -->|exceeded| ${prefix}_F[Fallback]`);
      } else {
        lines.push(`  ${prefix}_T -->|exceeded| ${prefix}_Fail((Timeout))`);
      }

      // Styles
      lines.push(`  style ${prefix}_T fill:#e67e22,stroke:#d35400,color:#fff`);
      if (timeoutNode.hasFallback) {
        lines.push(`  style ${prefix}_F fill:#2ecc71,stroke:#27ae60,color:#fff`);
      } else {
        lines.push(`  style ${prefix}_Fail fill:#e74c3c,stroke:#c0392b,color:#fff`);
      }
    }
  }

  return lines.join('\n');
}
