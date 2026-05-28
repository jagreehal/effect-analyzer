/**
 * Mermaid `stateDiagram-v2` renderer for plain-Effect state machines.
 *
 * Turns the (from, event, to) triples extracted by `analyzeStateMachines`
 * into an XState-style statechart: states are nodes, events label the edges.
 *
 * When a `StateMachineCoverage` is supplied, the diagram is annotated:
 * unreachable states (including declared-but-orphaned ones) are highlighted,
 * and unhandled events are listed in a note.
 */

import type { StateMachine, StateMachineAnalysis } from '../state-machine';
import type { StateMachineCoverage } from '../state-machine-coverage';

/** Mermaid state ids must be identifier-safe; remember the display label. */
function sanitizeId(text: string): string {
  const id = text.replace(/[^a-zA-Z0-9_]/g, '_');
  return /^[0-9]/.test(id) ? `s_${id}` : id;
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, '#quot;');
}

/** Render a single state machine as a `stateDiagram-v2`. */
export function renderStatechartMermaid(
  machine: StateMachine,
  coverage?: StateMachineCoverage,
): string {
  const lines: string[] = ['stateDiagram-v2'];
  lines.push(`  %% ${machine.name} (${machine.source})`);

  const usedStates = new Set(machine.states);
  // Unreachable states that actually appear in a transition can be styled
  // inline; fully-orphaned declared states (no edges) are surfaced in a note,
  // since mermaid's layout drops disconnected nodes.
  const unreachableUsed = (coverage?.unreachableStates ?? []).filter((s) =>
    usedStates.has(s),
  );
  const orphanStates = (coverage?.unreachableStates ?? []).filter(
    (s) => !usedStates.has(s),
  );
  const undeclared = new Set(coverage?.undeclaredStates ?? []);

  const idByState = new Map<string, string>();
  for (const state of machine.states) {
    const id = sanitizeId(state);
    idByState.set(state, id);
    if (id !== state) {
      lines.push(`  state "${escapeLabel(state)}" as ${id}`);
    }
  }
  const idOf = (s: string): string => idByState.get(s) ?? sanitizeId(s);

  if (machine.initial) {
    lines.push(`  [*] --> ${idOf(machine.initial)}`);
  }

  for (const t of machine.transitions) {
    const label = t.guard
      ? `${escapeLabel(t.event)} [${escapeLabel(t.guard)}]`
      : escapeLabel(t.event);
    lines.push(`  ${idOf(t.from)} --> ${idOf(t.to)}: ${label}`);
  }

  const hasOutgoing = new Set(machine.transitions.map((t) => t.from));
  for (const state of machine.states) {
    if (!hasOutgoing.has(state)) {
      lines.push(`  ${idOf(state)} --> [*]`);
    }
  }

  if (coverage) {
    if (unreachableUsed.length > 0 || undeclared.size > 0) {
      lines.push('  classDef unreachable fill:#5b1a1a,stroke:#e53e3e,color:#fff');
      lines.push('  classDef undeclared fill:#5b431a,stroke:#dd6b20,color:#fff');
      for (const s of unreachableUsed) lines.push(`  class ${idOf(s)} unreachable`);
      for (const s of undeclared) lines.push(`  class ${idOf(s)} undeclared`);
    }
    const noteParts: string[] = [];
    if (coverage.unhandledEvents.length > 0) {
      noteParts.push(`Unhandled events: ${coverage.unhandledEvents.join(', ')}`);
    }
    if (orphanStates.length > 0) {
      noteParts.push(`Unreachable states: ${orphanStates.join(', ')}`);
    }
    if (noteParts.length > 0 && machine.initial) {
      lines.push(`  note right of ${idOf(machine.initial)}`);
      for (const part of noteParts) lines.push(`    ${part}`);
      lines.push('  end note');
    }
  }

  return lines.join('\n');
}

/** Render every machine found in a file, one diagram each. */
export function renderStatechartsMermaid(
  analysis: StateMachineAnalysis,
  coverages?: readonly StateMachineCoverage[],
): string {
  if (analysis.machines.length === 0) {
    return 'stateDiagram-v2\n  %% No state machines detected';
  }
  const byName = new Map(coverages?.map((c) => [c.machine, c]));
  return analysis.machines
    .map((m) => renderStatechartMermaid(m, byName.get(m.name)))
    .join('\n\n');
}
