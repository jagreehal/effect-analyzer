/**
 * State machine coverage / completeness analysis.
 *
 * Cross-checks a machine's extracted transitions against its declared alphabet
 * (the full set of states/events from its types — a tagged union or a
 * Schema-derived type). This turns the statechart from "a drawing" into
 * "a verified machine": it reports events nothing handles, states nothing
 * reaches, and symbols that drifted away from the declared types.
 */

import type { StateMachine } from './state-machine';

export type CoverageKind =
  | 'unhandled-event'
  | 'unreachable-state'
  | 'undeclared-state'
  | 'undeclared-event'
  | 'dead-end-state';

export interface CoverageFinding {
  readonly kind: CoverageKind;
  readonly severity: 'warning' | 'info';
  readonly symbol: string;
  readonly message: string;
}

export interface StateMachineCoverage {
  readonly machine: string;
  readonly file: string | undefined;
  /** True when both declared alphabets were resolvable from the types. */
  readonly alphabetKnown: boolean;
  readonly alphabetSource: 'schema' | 'tagged-union' | 'config' | undefined;
  readonly declaredStates: readonly string[];
  readonly declaredEvents: readonly string[];
  readonly usedStates: readonly string[];
  readonly usedEvents: readonly string[];
  /** Declared events that no transition uses. */
  readonly unhandledEvents: readonly string[];
  /** States not reachable from the initial state (and not the initial itself). */
  readonly unreachableStates: readonly string[];
  /** Used states/events absent from the declared alphabet (drift / typo). */
  readonly undeclaredStates: readonly string[];
  readonly undeclaredEvents: readonly string[];
  /** Reachable states with no outgoing transition (treated as final). */
  readonly deadEndStates: readonly string[];
  readonly handledPairs: number;
  readonly totalPairs: number;
  /** handledPairs / totalPairs in [0,1]; 1 when there is nothing to cover. */
  readonly coverageRatio: number;
  readonly findings: readonly CoverageFinding[];
}

function unique(xs: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** States reachable from `initial` by following transitions. */
function reachableFrom(
  initial: string | undefined,
  adjacency: Map<string, Set<string>>,
): Set<string> {
  const reachable = new Set<string>();
  if (!initial) return reachable;
  const queue = [initial];
  reachable.add(initial);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    if (u === undefined) continue;
    for (const v of adjacency.get(u) ?? []) {
      if (!reachable.has(v)) {
        reachable.add(v);
        queue.push(v);
      }
    }
  }
  return reachable;
}

export function computeStateMachineCoverage(
  machine: StateMachine,
): StateMachineCoverage {
  const usedStates = machine.states;
  // Event-coverage is about transitions a user event triggers; automatic
  // (`initial`/`always`/`after`) transitions are reachability edges only.
  const eventTransitions = machine.transitions.filter(
    (t) => t.trigger === undefined,
  );
  const usedEvents = unique(eventTransitions.map((t) => t.event));

  const alphabetKnown =
    machine.declaredStates !== undefined && machine.declaredEvents !== undefined;
  // Fall back to observed symbols when the alphabet couldn't be resolved.
  const declaredStates = machine.declaredStates ?? usedStates;
  const declaredEvents = machine.declaredEvents ?? usedEvents;
  const stateSet = new Set(declaredStates);
  const eventSet = new Set(declaredEvents);

  // Reachability follows every edge (event + automatic). Outgoing bookkeeping
  // is split: `hasAnyOutgoing` for dead-end detection (a state that
  // auto-advances is not a dead end); `hasEventOutgoing` for coverage (only
  // states that handle events contribute (state,event) pairs).
  const adjacency = new Map<string, Set<string>>();
  const hasAnyOutgoing = new Set<string>();
  const hasEventOutgoing = new Set<string>();
  for (const t of machine.transitions) {
    hasAnyOutgoing.add(t.from);
    if (t.trigger === undefined) hasEventOutgoing.add(t.from);
    const set = adjacency.get(t.from) ?? new Set<string>();
    set.add(t.to);
    adjacency.set(t.from, set);
  }
  const reachable = reachableFrom(machine.initial, adjacency);

  // The universe of states to judge reachability against: declared ∪ used.
  const allStates = unique([...declaredStates, ...usedStates]);

  const unhandledEvents = alphabetKnown
    ? declaredEvents.filter((e) => !usedEvents.includes(e))
    : [];
  const unreachableStates = allStates.filter(
    (s) => s !== machine.initial && !reachable.has(s),
  );
  const undeclaredStates = alphabetKnown
    ? usedStates.filter((s) => !stateSet.has(s))
    : [];
  const undeclaredEvents = alphabetKnown
    ? usedEvents.filter((e) => !eventSet.has(e))
    : [];
  // A dead end has no outgoing edge of any kind (no event, no auto-advance).
  // States explicitly marked final are intentional, not dead ends.
  const explicitFinals = new Set(machine.finalStates ?? []);
  const deadEndStates = [...reachable].filter(
    (s) => !hasAnyOutgoing.has(s) && !explicitFinals.has(s),
  );

  // Coverage = handled (state,event) pairs over reachable states that actually
  // handle events. States whose only exit is automatic expect no events.
  const activeStates = [...reachable].filter((s) => hasEventOutgoing.has(s));
  const handledPerState = new Map<string, Set<string>>();
  for (const t of eventTransitions) {
    const set = handledPerState.get(t.from) ?? new Set<string>();
    set.add(t.event);
    handledPerState.set(t.from, set);
  }
  const totalPairs = activeStates.length * declaredEvents.length;
  let handledPairs = 0;
  for (const s of activeStates) {
    const handled = handledPerState.get(s);
    if (!handled) continue;
    for (const e of declaredEvents) if (handled.has(e)) handledPairs++;
  }
  const coverageRatio = totalPairs === 0 ? 1 : handledPairs / totalPairs;

  const findings: CoverageFinding[] = [];
  for (const e of unhandledEvents) {
    findings.push({
      kind: 'unhandled-event',
      severity: 'warning',
      symbol: e,
      message: `Event "${e}" is declared but no state handles it.`,
    });
  }
  for (const s of unreachableStates) {
    findings.push({
      kind: 'unreachable-state',
      severity: 'warning',
      symbol: s,
      message: `State "${s}" is not reachable from the initial state.`,
    });
  }
  for (const s of undeclaredStates) {
    findings.push({
      kind: 'undeclared-state',
      severity: 'warning',
      symbol: s,
      message: `State "${s}" is used in a transition but not in the declared states.`,
    });
  }
  for (const e of undeclaredEvents) {
    findings.push({
      kind: 'undeclared-event',
      severity: 'warning',
      symbol: e,
      message: `Event "${e}" is used in a transition but not in the declared events.`,
    });
  }
  for (const s of deadEndStates) {
    findings.push({
      kind: 'dead-end-state',
      severity: 'info',
      symbol: s,
      message: `State "${s}" has no outgoing transitions (treated as final).`,
    });
  }

  return {
    machine: machine.name,
    file: machine.location?.filePath,
    alphabetKnown,
    alphabetSource: machine.alphabetSource,
    declaredStates,
    declaredEvents,
    usedStates,
    usedEvents,
    unhandledEvents,
    unreachableStates,
    undeclaredStates,
    undeclaredEvents,
    deadEndStates,
    handledPairs,
    totalPairs,
    coverageRatio,
    findings,
  };
}
