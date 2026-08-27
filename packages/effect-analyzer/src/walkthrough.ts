/**
 * Side-effect-free walkthroughs of an Effect program.
 *
 * `generatePaths` enumerates every path at once, which explodes combinatorially
 * and gives you no way to steer. A walkthrough is the other half: one step at a
 * time, with every branch offered as an explicit choice rather than guessed.
 * The timeline is immutable, so `rewind` truncates the future and lets another
 * branch be explored from any earlier point.
 *
 * Nothing is executed and no value is invented. Where the IR cannot say what
 * happens — an `unknown` or `opaque` node — the step says so instead of
 * pretending.
 */

import { Option } from 'effect';
import {
  getStaticChildren,
  isStaticErrorHandlerNode,
  type StaticEffectIR,
  type StaticFlowNode,
} from './types';

export type ChoiceKind =
  | 'sequence'
  | 'success'
  | 'failure'
  | 'condition'
  | 'branch'
  | 'opaque';

export interface WalkChoice {
  readonly id: string;
  readonly label: string;
  readonly kind: ChoiceKind;
  /** The node this choice would step onto. */
  readonly nodeId: string;
}

export interface WalkStep {
  readonly nodeId: string;
  readonly label: string;
  /** How this step was reached; absent for the plain sequential case. */
  readonly via?: ChoiceKind;
}

/**
 * A position in a program: what has happened, and what can happen next.
 *
 * Opaque by design — the cursor it carries is an implementation detail, so a
 * walkthrough can only be moved with `advance`, `advanceWhileLinear`, and
 * `rewind`.
 */
export interface Walkthrough {
  readonly timeline: readonly WalkStep[];
  /** What can happen next. Empty exactly when `done`. */
  readonly choices: readonly WalkChoice[];
  readonly done: boolean;
  readonly [CursorId]: Cursor;
}

/**
 * Key for the walk cursor. Exported only because it appears in `Walkthrough`;
 * a symbol keeps the cursor out of spreads, JSON, and consumer code.
 *
 * @internal
 */
export const CursorId: unique symbol = Symbol('effect-analyzer/walkthrough-cursor');

interface Cursor {
  /** Nodes still to visit, outermost first. */
  readonly frontier: readonly StaticFlowNode[];
  /** The IR being walked, so `rewind` can replay from the start. */
  readonly ir: StaticEffectIR;
  /** Choice ids taken so far, replayed by `rewind`. */
  readonly taken: readonly string[];
}

/** Wrappers that carry no step of their own — step into their children. */
const isTransparent = (node: StaticFlowNode): boolean =>
  node.type === 'generator' || node.type === 'pipe';

const labelOf = (node: StaticFlowNode): string => {
  const named = node as { displayName?: string; name?: string; callee?: string };
  return named.displayName ?? named.name ?? named.callee ?? node.type;
};

const childrenOf = (node: StaticFlowNode): readonly StaticFlowNode[] =>
  Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);

/** Expand wrappers until the head of the frontier is a node worth showing. */
function normalize(frontier: readonly StaticFlowNode[]): readonly StaticFlowNode[] {
  const [head, ...rest] = frontier;
  if (head === undefined) return [];
  if (!isTransparent(head)) return frontier;
  return normalize([...childrenOf(head), ...rest]);
}

function choicesFor(frontier: readonly StaticFlowNode[]): readonly WalkChoice[] {
  const [head, ...rest] = frontier;
  if (head === undefined) return [];

  if (isStaticErrorHandlerNode(head)) {
    const success: WalkChoice = {
      id: `${head.id}:success`,
      label: `${labelOf(head)} — succeeds`,
      kind: 'success',
      nodeId: head.source.id,
    };
    if (!head.handler) return [success];
    return [
      success,
      {
        id: `${head.id}:failure`,
        label: `${labelOf(head)} — fails, handler runs`,
        kind: 'failure',
        nodeId: head.handler.id,
      },
    ];
  }

  if (head.type === 'conditional' || head.type === 'decision' || head.type === 'switch') {
    return childrenOf(head).map((child, index) => ({
      id: `${head.id}:cond:${index}`,
      label: `${labelOf(head)} — ${labelOf(child)}`,
      kind: 'condition' as const,
      nodeId: child.id,
    }));
  }

  if (head.type === 'race' || head.type === 'parallel') {
    return childrenOf(head).map((child, index) => ({
      id: `${head.id}:branch:${index}`,
      label: `${labelOf(head)} — ${labelOf(child)}`,
      kind: 'branch' as const,
      nodeId: child.id,
    }));
  }

  if (head.type === 'unknown' || head.type === 'opaque') {
    return [
      {
        id: `${head.id}:opaque`,
        label: `${labelOf(head)} — not analyzable, contents unknown`,
        kind: 'opaque',
        nodeId: head.id,
      },
    ];
  }

  void rest;
  return [
    {
      id: `${head.id}:next`,
      label: labelOf(head),
      kind: 'sequence',
      nodeId: head.id,
    },
  ];
}

const build = (
  ir: StaticEffectIR,
  frontier: readonly StaticFlowNode[],
  timeline: readonly WalkStep[],
  taken: readonly string[],
): Walkthrough => {
  const normalized = normalize(frontier);
  const choices = choicesFor(normalized);
  return {
    timeline,
    choices,
    done: choices.length === 0,
    [CursorId]: { frontier: normalized, ir, taken },
  };
};

const cursorOf = (walk: Walkthrough): Cursor => walk[CursorId];

/** Start at the top of a program with nothing taken yet. */
export function beginWalkthrough(ir: StaticEffectIR): Walkthrough {
  return build(ir, ir.root.children, [], []);
}

/** Take one offered choice. Throws if the id is not currently on offer. */
export function advance(walk: Walkthrough, choiceId: string): Walkthrough {
  const choice = walk.choices.find((c) => c.id === choiceId);
  if (!choice) {
    throw new Error(
      `Choice "${choiceId}" is not available. On offer: ${walk.choices.map((c) => c.id).join(', ') || '(none)'}`,
    );
  }

  const { frontier, ir, taken } = cursorOf(walk);
  const [head, ...rest] = frontier;
  if (head === undefined) return walk;

  const next = ((): readonly StaticFlowNode[] => {
    if (isStaticErrorHandlerNode(head)) {
      return choice.kind === 'failure' && head.handler
        ? [head.source, head.handler, ...rest]
        : [head.source, ...rest];
    }
    if (choice.kind === 'condition' || choice.kind === 'branch') {
      const child = childrenOf(head).find((c) => c.id === choice.nodeId);
      return child ? [child, ...rest] : rest;
    }
    return rest;
  })();

  // The error-handler frontier is re-entered rather than consumed, so the step
  // is recorded only once the concrete node underneath is taken.
  const timeline =
    head.type === 'error-handler'
      ? walk.timeline
      : [
          ...walk.timeline,
          {
            nodeId: choice.nodeId,
            label: labelOf(head),
            ...(choice.kind === 'sequence' ? {} : { via: choice.kind }),
          },
        ];

  return build(ir, next, timeline, [...taken, choiceId]);
}

/** Follow the program while exactly one thing can happen next. */
export function advanceWhileLinear(walk: Walkthrough): Walkthrough {
  let current = walk;
  for (let only = current.choices[0]; current.choices.length === 1 && only; only = current.choices[0]) {
    current = advance(current, only.id);
  }
  return current;
}

/**
 * Return to the state after `stepCount` steps, discarding everything after it.
 * Replays the retained choices, so the result is a real walkthrough that can be
 * advanced down a different branch.
 */
export function rewind(walk: Walkthrough, stepCount: number): Walkthrough {
  if (stepCount >= walk.timeline.length) return walk;
  const { ir, taken } = cursorOf(walk);
  let current = beginWalkthrough(ir);
  for (const choiceId of taken) {
    if (current.timeline.length >= stepCount) break;
    current = advance(current, choiceId);
  }
  return current;
}
