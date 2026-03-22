import type { StaticEffectIR } from '../types';
import { renderStaticMermaid } from '../output/mermaid';
import type { ProgramDiff, DiffMermaidOptions } from './types';

/**
 * Build a mapping from step id → mermaid node id by parsing the rendered
 * mermaid output. The effect-analyzer renderer uses `n1`, `n2`, etc.
 */
function buildStepIdMap(mermaidOutput: string): Map<string, string> {
  const map = new Map<string, string>();
  // Match lines like:  n2["Effect.succeed"]
  const nodePattern = /^\s*(n\d+)\["[^"]*"\]/gm;
  let match: RegExpExecArray | null;
  while ((match = nodePattern.exec(mermaidOutput)) !== null) {
    const id = match[1] ?? '';
    // The mermaid node id is e.g. "n2"
    // We store the raw mermaid id — callers will correlate via position
    map.set(id, id);
  }
  return map;
}

/**
 * Render a mermaid diagram of the "after" IR with diff annotations overlaid
 * (style classes for added, removed, moved, renamed steps).
 */
export function renderDiffMermaid(
  after: StaticEffectIR,
  diff: ProgramDiff,
  options?: DiffMermaidOptions,
): string {
  const direction = options?.direction ?? 'TB';
  const showRemoved = options?.showRemovedSteps ?? false;

  // Render the base mermaid for the "after" IR
  const baseMermaid = renderStaticMermaid(after, { direction });

  const _stepIdMap = buildStepIdMap(baseMermaid);

  // Collect step ids by kind for styling
  const addedIds = new Set(diff.steps.filter((s) => s.kind === 'added').map((s) => s.stepId));
  const _removedIds = new Set(diff.steps.filter((s) => s.kind === 'removed').map((s) => s.stepId));
  const movedIds = new Set(diff.steps.filter((s) => s.kind === 'moved').map((s) => s.stepId));
  const renamedIds = new Set(diff.steps.filter((s) => s.kind === 'renamed').map((s) => s.stepId));

  // Walk the "after" IR to build ir-id → mermaid-id mapping
  // We parse the mermaid output to find which mermaid node id corresponds to which IR node id
  const irToMermaid = new Map<string, string>();
  const lines = baseMermaid.split('\n');

  // The renderer assigns mermaid ids in traversal order. We need to correlate
  // them with IR node ids. The simplest approach: scan for node definitions
  // and use the rendered mermaid output's nodeIdMap if available, otherwise
  // try to match based on label content.
  // Since renderStaticMermaid doesn't expose the nodeIdMap, we annotate by
  // scanning each diff step's callee in the mermaid output.

  // Build annotation lines
  const styleLines: string[] = [];

  // For each line that defines a node, try to match it to a diff entry
  for (const line of lines) {
    const nodeMatch = /^\s*(n\d+)\["([^"]*)"\]/.exec(line);
    if (!nodeMatch) continue;
    const mermaidId = nodeMatch[1] ?? '';
    const label = nodeMatch[2] ?? '';

    // Try matching by callee or displayName in the label
    for (const step of diff.steps) {
      if (step.callee && label.includes(step.callee)) {
        irToMermaid.set(step.stepId, mermaidId);
        break;
      }
    }
  }

  // Apply style classes
  for (const [irId, mermaidId] of irToMermaid) {
    if (addedIds.has(irId)) {
      styleLines.push(`  style ${mermaidId} fill:#d4edda,stroke:#28a745,stroke-width:2px`);
    } else if (movedIds.has(irId)) {
      styleLines.push(`  style ${mermaidId} fill:#fff3cd,stroke:#ffc107,stroke-width:2px`);
    } else if (renamedIds.has(irId)) {
      styleLines.push(`  style ${mermaidId} fill:#cce5ff,stroke:#007bff,stroke-width:2px`);
    }
  }

  // For removed steps, optionally add phantom nodes
  if (showRemoved) {
    for (const step of diff.steps) {
      if (step.kind === 'removed') {
        const phantomId = `removed_${step.stepId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        styleLines.push(`  ${phantomId}["❌ ${step.callee ?? step.stepId}"]`);
        styleLines.push(
          `  style ${phantomId} fill:#f8d7da,stroke:#dc3545,stroke-width:2px,stroke-dasharray: 5 5`,
        );
      }
    }
  }

  if (styleLines.length === 0) {
    return baseMermaid;
  }

  // Insert style lines before the closing of the diagram
  // The base mermaid ends with classDef/class lines or just edges.
  // We append our style lines at the end.
  return baseMermaid.trimEnd() + '\n' + styleLines.join('\n') + '\n';
}
