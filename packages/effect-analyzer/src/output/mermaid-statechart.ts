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

import { finalStatesOf } from '../state-machine';
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

  const idOf = (s: string): string => sanitizeId(s);

  // Hierarchy: a dotted state name ('Playing.Paused') nests under its parent
  // segments, which become composite states. Flat machines have no dots and
  // render exactly as before.
  const childrenOf = new Map<string, string[]>(); // parent path ('' = root) → child paths
  const known = new Set<string>();
  for (const state of machine.states) {
    let path = '';
    for (const seg of state.split('.')) {
      const parent = path;
      path = path === '' ? seg : `${path}.${seg}`;
      if (known.has(path)) continue;
      known.add(path);
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), path]);
    }
  }

  // Compound-initial edges (trigger 'initial') render as [*] markers inside
  // their parent's block, not as labeled edges.
  const initialsOf = new Map<string, string[]>();
  for (const t of machine.transitions) {
    if (t.trigger !== 'initial') continue;
    initialsOf.set(t.from, [...(initialsOf.get(t.from) ?? []), t.to]);
  }

  const emitState = (path: string, indent: string): void => {
    const id = idOf(path);
    const kids = childrenOf.get(path) ?? [];
    const label = path.includes('.') ? (path.split('.').pop() ?? path) : path;
    if (kids.length === 0) {
      if (id !== path || label !== path) {
        lines.push(`${indent}state "${escapeLabel(label)}" as ${id}`);
      }
      return;
    }
    lines.push(
      id === label
        ? `${indent}state ${id} {`
        : `${indent}state "${escapeLabel(label)}" as ${id} {`,
    );
    for (const to of initialsOf.get(path) ?? []) {
      lines.push(`${indent}  [*] --> ${idOf(to)}`);
    }
    for (const kid of kids) emitState(kid, `${indent}  `);
    lines.push(`${indent}}`);
  };
  for (const top of childrenOf.get('') ?? []) emitState(top, '  ');

  if (machine.initial) {
    lines.push(`  [*] --> ${idOf(machine.initial)}`);
  }

  // Entry/exit action and invoke labels as state description lines.
  for (const state of machine.states) {
    const entry = machine.entryActions?.[state];
    const exit = machine.exitActions?.[state];
    const invokes = machine.invokes?.[state];
    if (entry) lines.push(`  ${idOf(state)} : entry / ${escapeLabel(entry.join(', '))}`);
    if (exit) lines.push(`  ${idOf(state)} : exit / ${escapeLabel(exit.join(', '))}`);
    for (const invoke of invokes ?? []) {
      const label = invoke.id === undefined
        ? invoke.src
        : `${invoke.src} (${invoke.id})`;
      lines.push(`  ${idOf(state)} : invoke ${escapeLabel(label)}`);
    }
  }

  for (const t of machine.transitions) {
    if (t.trigger === 'initial' && (childrenOf.get(t.from)?.length ?? 0) > 0) {
      continue; // rendered as a [*] marker inside the parent block
    }
    let label = escapeLabel(t.event);
    if (t.guard) label += ` [${escapeLabel(t.guard)}]`;
    if (t.actions && t.actions.length > 0) {
      label += ` / ${escapeLabel(t.actions.join(', '))}`;
    }
    lines.push(`  ${idOf(t.from)} --> ${idOf(t.to)}: ${label}`);
  }

  const finals = finalStatesOf(machine);
  for (const state of machine.states) {
    if (finals.has(state)) {
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
