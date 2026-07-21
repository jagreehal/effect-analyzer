/**
 * MachineJSON ingestion.
 *
 * Turns an XState v6 `MachineJSON` (the canonical machine-as-data shape) into
 * the analyzer's {@link StateMachine} IR, so a machine authored *anywhere* can
 * be run through the same coverage / reachability / diagnostics engine and the
 * same statechart renderers as machines extracted from source.
 *
 * `MachineJSON` is a standard data format (XState / Stately, hand-written
 * configs, or any library that emits it). This module deliberately takes **no
 * dependency** on any authoring library — it only reads the format's shape.
 * The declared alphabet is exact here: states come from the recursive config
 * tree and events come from `schemas.events` when available (falling back to
 * `on` keys), so coverage can use `alphabetSource: 'config'`.
 *
 * `on` (event), `always` (eventless), and `after` (delayed) transitions are all
 * ingested. Automatic initial/always/after transitions carry a `trigger` tag
 * so coverage counts them as reachability edges without treating them as events.
 */

import type { StateInvoke, StateMachine, StateTransition } from './state-machine';

// =============================================================================
// MachineJSON shape (structural — the XState v6 machine-as-data format)
// =============================================================================

export interface MachineJSONUnserializable {
  readonly $unserializable: 'function' | 'actor' | 'schema' | 'value';
  readonly id?: string;
}

export type MachineJSONExpression =
  | { readonly '@expr': string; readonly '@lang'?: string }
  | { readonly '@code': string; readonly '@lang'?: string };

export type MachineJSONGuard =
  | { readonly type: string; readonly params?: Readonly<Record<string, unknown>> }
  | MachineJSONUnserializable
  | MachineJSONExpression;

export type MachineJSONAction =
  | { readonly type: string; readonly [key: string]: unknown }
  | MachineJSONUnserializable
  | MachineJSONExpression;

export interface MachineJSONTransition {
  readonly target?: string | readonly string[];
  readonly guard?: MachineJSONGuard;
  readonly actions?: readonly MachineJSONAction[];
}

type MachineJSONSingleValue = string | MachineJSONTransition | MachineJSONUnserializable;

export type MachineJSONValue =
  | MachineJSONSingleValue
  | readonly MachineJSONSingleValue[];

export type MachineJSONInitial =
  | string
  | { readonly target: string; readonly input?: unknown };

export interface MachineJSONInvoke {
  readonly id?: string;
  readonly src: string | MachineJSONUnserializable;
  readonly onDone?: MachineJSONValue;
  readonly onError?: MachineJSONValue;
}

export interface MachineJSONStateNode {
  readonly id?: string;
  readonly type?: 'atomic' | 'compound' | 'parallel' | 'final' | 'history' | 'choice';
  readonly initial?: MachineJSONInitial;
  readonly states?: Record<string, MachineJSONStateNode>;
  readonly entry?: readonly MachineJSONAction[];
  readonly exit?: readonly MachineJSONAction[];
  readonly invoke?: MachineJSONInvoke | readonly MachineJSONInvoke[];
  readonly on?: Record<string, MachineJSONValue>;
  readonly always?: MachineJSONValue;
  readonly after?: Record<string, MachineJSONValue>;
}

export interface MachineJSON {
  readonly id?: string;
  readonly version?: string;
  readonly initial: MachineJSONInitial;
  readonly states: Record<string, MachineJSONStateNode>;
  readonly schemas?: {
    readonly events?: Record<string, unknown> | MachineJSONUnserializable;
  };
}

export interface FromMachineJSONOptions {
  /** Overrides the machine name (defaults to `json.id`, then `'machine'`). */
  readonly name?: string;
}

// =============================================================================
// Validation (trust boundary — MachineJSON is often parsed from untrusted text)
// =============================================================================

/** Non-null, non-array object — used only to check genuinely `unknown` input. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Throw a uniform, located error unless `value` is a plain object. */
function requireObject(value: unknown, what: string): void {
  if (!isPlainObject(value)) {
    throw new Error(`fromMachineJSON: ${what} must be an object`);
  }
}

function markerLabel(value: MachineJSONUnserializable): string {
  return value.id ?? `$unserializable:${value.$unserializable}`;
}

function invokeSource(
  value: unknown,
  where: string,
): StateInvoke {
  if (typeof value === 'string') return { src: value };
  if (!isPlainObject(value)) {
    throw new Error(
      `fromMachineJSON: ${where}.src must be a string or $unserializable object`,
    );
  }
  const marker = value;
  const kind = marker.$unserializable;
  if (
    kind !== 'function' &&
    kind !== 'actor' &&
    kind !== 'schema' &&
    kind !== 'value'
  ) {
    throw new Error(
      `fromMachineJSON: ${where}.src must contain a valid $unserializable marker`,
    );
  }
  if (marker.id !== undefined && typeof marker.id !== 'string') {
    throw new Error(`fromMachineJSON: ${where}.src.id must be a string`);
  }
  return {
    src: marker.id ?? `$unserializable:${kind}`,
  };
}

function guardLabel(value: MachineJSONGuard, where: string): string {
  if (!isPlainObject(value)) {
    throw new Error(`fromMachineJSON: ${where}.guard must be an object`);
  }
  const record = value as unknown as Record<string, unknown>;
  if (typeof record.type === 'string') return record.type;
  if (typeof record['@expr'] === 'string') return record['@expr'];
  if (typeof record['@code'] === 'string') return record['@code'];
  if (typeof record.$unserializable === 'string') {
    return markerLabel(record as unknown as MachineJSONUnserializable);
  }
  throw new Error(
    `fromMachineJSON: ${where}.guard must contain type, @expr, @code, or $unserializable`,
  );
}

/** Best-effort label for an action: its type, expression text, or marker. */
function actionLabel(value: MachineJSONAction): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const record = value as unknown as Record<string, unknown>;
  if (typeof record.type === 'string') return record.type;
  if (typeof record['@expr'] === 'string') return record['@expr'];
  if (typeof record['@code'] === 'string') return record['@code'];
  if (typeof record.$unserializable === 'string') {
    return markerLabel(record as unknown as MachineJSONUnserializable);
  }
  return undefined;
}

function actionLabels(
  value: readonly MachineJSONAction[] | undefined,
): string[] | undefined {
  if (value === undefined) return undefined;
  const labels = value.map(actionLabel).filter((x): x is string => x !== undefined);
  return labels.length > 0 ? labels : undefined;
}

/** Normalize a transition value to one record per target/branch. */
function normalizeValue(
  value: MachineJSONValue,
  where: string,
): readonly { target?: string; guard?: string; actions?: readonly string[] }[] {
  const one = (
    v: MachineJSONSingleValue,
  ): readonly { target?: string; guard?: string; actions?: readonly string[] }[] => {
    if (typeof v === 'string') return [{ target: v }];
    if (!isPlainObject(v)) {
      throw new Error(`fromMachineJSON: ${where} must be a string or object, got ${typeof v}`);
    }
    if (typeof v.$unserializable === 'string') {
      return [{ guard: markerLabel(v as unknown as MachineJSONUnserializable) }];
    }

    const transition = v as unknown as MachineJSONTransition;
    const target: unknown = transition.target;
    let targets: readonly (string | undefined)[];
    if (target === undefined) {
      targets = [undefined];
    } else if (typeof target === 'string') {
      targets = [target];
    } else if (Array.isArray(target) && target.every((candidate) => typeof candidate === 'string')) {
      targets = target;
    } else {
      throw new Error(`fromMachineJSON: ${where}.target must be a string or string array`);
    }
    const guard = transition.guard === undefined ? undefined : guardLabel(transition.guard, where);
    const actions = actionLabels(transition.actions);
    return targets.map((candidate) => ({
      ...(candidate !== undefined ? { target: candidate } : {}),
      ...(guard !== undefined ? { guard } : {}),
      ...(actions !== undefined ? { actions } : {}),
    }));
  };

  if (Array.isArray(value)) return value.flatMap(one);
  return one(value as MachineJSONSingleValue);
}

function initialTarget(value: MachineJSONInitial, where: string): string {
  if (typeof value === 'string') return value;
  requireObject(value, where);
  if (typeof value.target !== 'string') {
    throw new Error(`fromMachineJSON: ${where}.target must be a string`);
  }
  return value.target;
}

// =============================================================================
// Ingestion
// =============================================================================

/** Label an `after` delay key readably: `after 500ms` / `after PT1M`. */
function afterLabel(delayKey: string): string {
  return /^\d+$/.test(delayKey) ? `after ${delayKey}ms` : `after ${delayKey}`;
}

/**
 * Build a {@link StateMachine} from an XState v6 `MachineJSON`.
 *
 * @throws if the input is not a well-formed MachineJSON (malformed `initial`,
 *   non-object `states`, or a malformed transition target/guard).
 */
export function fromMachineJSON(
  json: MachineJSON,
  options?: FromMachineJSONOptions,
): StateMachine {
  requireObject(json, 'input');
  const rootInitial = initialTarget(json.initial, '`initial`');
  const states = json.states;
  requireObject(states, '`states`');

  const entries: {
    readonly path: string;
    readonly parentPath: string | undefined;
    readonly node: MachineJSONStateNode;
  }[] = [];
  const idToPath = new Map<string, string>();

  const collectStates = (
    children: Record<string, MachineJSONStateNode>,
    parentPath?: string,
  ): void => {
    for (const [key, node] of Object.entries(children)) {
      requireObject(node, `state '${parentPath === undefined ? key : `${parentPath}.${key}`}'`);
      const path = parentPath === undefined ? key : `${parentPath}.${key}`;
      entries.push({ path, parentPath, node });
      idToPath.set(path, path);
      if (node.id !== undefined) {
        if (typeof node.id !== 'string') {
          throw new Error(`fromMachineJSON: state '${path}'.id must be a string`);
        }
        idToPath.set(node.id, path);
      }
      if (node.states !== undefined) {
        requireObject(node.states, `state '${path}'.states`);
        collectStates(node.states, path);
      }
    }
  };
  collectStates(states);

  const declaredStates = entries.map(({ path }) => path);
  const transitions: StateTransition[] = [];
  const observedEvents: string[] = [];
  const seenEvents = new Set<string>();

  const resolveTarget = (
    target: string,
    from: string,
    parentPath: string | undefined,
  ): string => {
    if (target.startsWith('#')) return idToPath.get(target.slice(1)) ?? target.slice(1);
    if (target.startsWith('.')) return `${from}${target}`;
    return parentPath === undefined ? target : `${parentPath}.${target}`;
  };

  const resolveInitialTarget = (target: string, from?: string): string => {
    if (target.startsWith('#')) return idToPath.get(target.slice(1)) ?? target.slice(1);
    if (from === undefined) return target.startsWith('.') ? target.slice(1) : target;
    return `${from}.${target.startsWith('.') ? target.slice(1) : target}`;
  };

  // Emit one transition per normalized branch of a value, self-edging on a
  // targetless (internal / automatic-without-target) transition.
  const emit = (
    from: string,
    event: string,
    value: MachineJSONValue,
    where: string,
    parentPath: string | undefined,
    trigger?: 'always' | 'after' | 'done' | 'error',
    invokeIndex?: number,
  ): void => {
    for (const norm of normalizeValue(value, where)) {
      transitions.push({
        from,
        event,
        to: norm.target === undefined ? from : resolveTarget(norm.target, from, parentPath),
        ...(norm.guard !== undefined ? { guard: norm.guard } : {}),
        ...(norm.actions !== undefined ? { actions: norm.actions } : {}),
        ...(trigger !== undefined ? { trigger } : {}),
        ...(invokeIndex !== undefined ? { invokeIndex } : {}),
      });
    }
  };

  const entryActions: Record<string, readonly string[]> = {};
  const exitActions: Record<string, readonly string[]> = {};
  const invokes: Record<string, readonly StateInvoke[]> = {};

  for (const { path: from, parentPath, node } of entries) {
    const entry = actionLabels(node.entry);
    if (entry !== undefined) entryActions[from] = entry;
    const exit = actionLabels(node.exit);
    if (exit !== undefined) exitActions[from] = exit;

    // Invoked effects: preserve every invoke and associate its completion
    // transitions by index so the XState exporter can rebuild the array.
    const invokeValues: readonly MachineJSONInvoke[] =
      node.invoke === undefined
        ? []
        : Array.isArray(node.invoke)
          ? node.invoke
          : [node.invoke];
    if (invokeValues.length > 0) {
      const metadata: StateInvoke[] = [];
      for (const [invokeIndex, invoke] of invokeValues.entries()) {
        const where = `state '${from}'.invoke[${invokeIndex}]`;
        requireObject(invoke, where);
        if (invoke.id !== undefined && typeof invoke.id !== 'string') {
          throw new Error(`fromMachineJSON: ${where}.id must be a string`);
        }
        metadata.push({
          ...invokeSource(invoke.src, where),
          ...(invoke.id !== undefined ? { id: invoke.id } : {}),
        });
        if (invoke.onDone !== undefined) {
          emit(
            from,
            'onDone',
            invoke.onDone,
            `${where}.onDone`,
            parentPath,
            'done',
            invokeIndex,
          );
        }
        if (invoke.onError !== undefined) {
          emit(
            from,
            'onError',
            invoke.onError,
            `${where}.onError`,
            parentPath,
            'error',
            invokeIndex,
          );
        }
      }
      invokes[from] = metadata;
    }
    if (node.initial !== undefined) {
      transitions.push({
        from,
        event: 'initial',
        to: resolveInitialTarget(initialTarget(node.initial, `state '${from}'.initial`), from),
        trigger: 'initial',
      });
    } else if (node.type === 'parallel' && node.states !== undefined) {
      for (const child of Object.keys(node.states)) {
        transitions.push({ from, event: 'initial', to: `${from}.${child}`, trigger: 'initial' });
      }
    }

    const on = node.on;
    if (on !== undefined) {
      requireObject(on, `state '${from}'.on`);
      for (const [event, value] of Object.entries(on)) {
        if (!seenEvents.has(event)) {
          seenEvents.add(event);
          observedEvents.push(event);
        }
        emit(from, event, value, `state '${from}' event '${event}'`, parentPath);
      }
    }

    // Eventless: fires automatically when the state is entered and its guard
    // passes. A reachability edge, not an event.
    if (node.always !== undefined) {
      emit(from, 'always', node.always, `state '${from}'.always`, parentPath, 'always');
    }

    // Delayed: fires automatically after the given delay. Also reachability.
    const after = node.after;
    if (after !== undefined) {
      requireObject(after, `state '${from}'.after`);
      for (const [delayKey, value] of Object.entries(after)) {
        emit(
          from,
          afterLabel(delayKey),
          value,
          `state '${from}'.after['${delayKey}']`,
          parentPath,
          'after',
        );
      }
    }
  }

  const schemaEvents = json.schemas?.events;
  if (schemaEvents !== undefined) {
    requireObject(schemaEvents, '`schemas.events`');
  }
  const declaredEvents =
    schemaEvents !== undefined && !('$unserializable' in schemaEvents)
      ? Object.keys(schemaEvents)
      : observedEvents;

  return {
    name: options?.name ?? json.id ?? 'machine',
    source: 'machine-json',
    initial: resolveInitialTarget(rootInitial),
    // The full config state set (not just states appearing in transitions) so
    // final/orphan states still render and are judged for reachability.
    states: declaredStates,
    transitions,
    location: undefined,
    declaredStates,
    declaredEvents,
    alphabetSource: 'config',
    // Explicit finals only: a transitionless `{}` node is active, not final.
    finalStates: entries
      .filter(({ node }) => node.type === 'final')
      .map(({ path }) => path),
    ...(entries.some(({ node }) => node.type === 'parallel')
      ? {
          parallelStates: entries
            .filter(({ node }) => node.type === 'parallel')
            .map(({ path }) => path),
        }
      : {}),
    ...(Object.keys(entryActions).length > 0 ? { entryActions } : {}),
    ...(Object.keys(exitActions).length > 0 ? { exitActions } : {}),
    ...(Object.keys(invokes).length > 0 ? { invokes } : {}),
  };
}
