/**
 * XState config emitter.
 *
 * Turns an extracted plain-Effect state machine into an XState v5/v6
 * `createMachine({...})` config. The point: you write deterministic
 * Effect code (no XState), and this gives you a config you can paste
 * straight into the Stately visualizer (stately.ai/viz) to get the real
 * interactive statechart — for free.
 *
 * Dotted state names ('Playing.Paused') emit nested `states`, automatic
 * transitions emit `always` / `after` keys, and hierarchical machines use
 * absolute `#id.path` targets so cross-level transitions resolve.
 */

import { finalStatesOf } from '../state-machine';
import type { StateMachine, StateTransition } from '../state-machine';

/** A single-quoted string literal, escaping backslashes and apostrophes. */
const str = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A safe JS identifier stays bare; anything else becomes a quoted string. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name);
}

interface Target {
  readonly to: string;
  readonly guard?: string;
  readonly actions?: readonly string[];
}

function sameActions(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

function dedupe(ts: readonly StateTransition[]): Target[] {
  const out: Target[] = [];
  for (const t of ts) {
    if (
      !out.some(
        (x) => x.to === t.to && x.guard === t.guard && sameActions(x.actions, t.actions),
      )
    ) {
      out.push({
        to: t.to,
        ...(t.guard !== undefined ? { guard: t.guard } : {}),
        ...(t.actions !== undefined ? { actions: t.actions } : {}),
      });
    }
  }
  return out;
}

export function renderXStateConfig(machine: StateMachine): string {
  const finals = finalStatesOf(machine);
  const hierarchical = machine.states.some((s) => s.includes('.'));
  const ref = (to: string): string =>
    hierarchical ? str(`#${machine.name}.${to}`) : str(to);
  const strList = (xs: readonly string[]): string => `[${xs.map(str).join(', ')}]`;
  const transitionObj = (x: Target): string => {
    const fields = [`target: ${ref(x.to)}`];
    if (x.guard !== undefined) fields.push(`guard: ${str(x.guard)}`);
    if (x.actions !== undefined) fields.push(`actions: ${strList(x.actions)}`);
    return `{ ${fields.join(', ')} }`;
  };
  /** String shorthand for a single bare target, else an array of objects. */
  const targetValue = (targets: readonly Target[]): string => {
    const first = targets[0];
    return targets.length === 1 &&
      first &&
      first.guard === undefined &&
      first.actions === undefined
      ? ref(first.to)
      : `[${targets.map(transitionObj).join(', ')}]`;
  };

  // Build the state tree: dotted names nest, ancestor segments are implied.
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

  const byFrom = new Map<string, StateTransition[]>();
  for (const path of known) byFrom.set(path, []);
  const compoundInitial = new Map<string, string>(); // parent path → initial child path
  for (const t of machine.transitions) {
    if (t.trigger === 'initial') {
      if (!compoundInitial.has(t.from)) compoundInitial.set(t.from, t.to);
      continue;
    }
    byFrom.get(t.from)?.push(t);
  }
  // A dotted machine.initial implies the initial child at every level it passes.
  if (machine.initial?.includes('.')) {
    const segs = machine.initial.split('.');
    let path = segs[0] ?? '';
    for (const seg of segs.slice(1)) {
      const child = `${path}.${seg}`;
      if (!compoundInitial.has(path)) compoundInitial.set(path, child);
      path = child;
    }
  }
  /** Direct child key on the way from `path` to the full path `target`. */
  const childKeyToward = (path: string, target: string): string | undefined =>
    target.startsWith(`${path}.`)
      ? target.slice(path.length + 1).split('.')[0]
      : undefined;

  const parallel = new Set(machine.parallelStates ?? []);

  const renderNode = (path: string, indent: string): string => {
    const label = path.includes('.') ? (path.split('.').pop() ?? path) : path;
    const kids = childrenOf.get(path) ?? [];
    const outs = byFrom.get(path) ?? [];
    const events = outs.filter((t) => t.trigger === undefined);
    const always = outs.filter((t) => t.trigger === 'always');
    const afters = outs.filter((t) => t.trigger === 'after');
    const dones = outs.filter((t) => t.trigger === 'done');
    const errors = outs.filter((t) => t.trigger === 'error');
    const parts: string[] = [];

    const entry = machine.entryActions?.[path];
    if (entry) parts.push(`entry: ${strList(entry)}`);
    const exit = machine.exitActions?.[path];
    if (exit) parts.push(`exit: ${strList(exit)}`);
    const invokes = machine.invokes?.[path] ?? [];
    if (invokes.length > 0) {
      const configs = invokes.map((invoke, invokeIndex) => {
        const belongsToInvoke = (t: StateTransition): boolean =>
          t.invokeIndex === invokeIndex ||
          (t.invokeIndex === undefined && invokes.length === 1);
        const invokeDones = dones.filter(belongsToInvoke);
        const invokeErrors = errors.filter(belongsToInvoke);
        const fields = [`src: ${str(invoke.src)}`];
        if (invoke.id !== undefined) fields.push(`id: ${str(invoke.id)}`);
        if (invokeDones.length > 0) {
          fields.push(`onDone: ${targetValue(dedupe(invokeDones))}`);
        }
        if (invokeErrors.length > 0) {
          fields.push(`onError: ${targetValue(dedupe(invokeErrors))}`);
        }
        return `{ ${fields.join(', ')} }`;
      });
      parts.push(
        invokes.length === 1
          ? `invoke: ${configs[0]}`
          : `invoke: [${configs.join(', ')}]`,
      );
    }

    if (events.length > 0) {
      const byEvent = new Map<string, StateTransition[]>();
      for (const t of events) {
        byEvent.set(t.event, [...(byEvent.get(t.event) ?? []), t]);
      }
      const on = [...byEvent]
        .map(([event, ts]) => `${key(event)}: ${targetValue(dedupe(ts))}`)
        .join(', ');
      parts.push(`on: { ${on} }`);
    }
    if (always.length > 0) {
      parts.push(`always: ${targetValue(dedupe(always))}`);
    }
    if (afters.length > 0) {
      // Event labels are `after 5000ms` / `after PT1M`; the delay becomes the key.
      const byDelay = new Map<string, StateTransition[]>();
      for (const t of afters) {
        const raw = t.event.replace(/^after\s+/, '');
        const ms = /^(\d+)ms$/.exec(raw)?.[1] ?? (/^\d+$/.test(raw) ? raw : undefined);
        const delay = ms ?? raw;
        byDelay.set(delay, [...(byDelay.get(delay) ?? []), t]);
      }
      const after = [...byDelay]
        .map(([delay, ts]) => `${key(delay)}: ${targetValue(dedupe(ts))}`)
        .join(', ');
      parts.push(`after: { ${after} }`);
    }
    if (kids.length > 0) {
      if (parallel.has(path)) {
        // Every region is entered; parallel nodes carry no initial.
        parts.push(`type: 'parallel'`);
      } else {
        const target = compoundInitial.get(path);
        const initKey =
          (target !== undefined ? childKeyToward(path, target) : undefined) ??
          childKeyToward(path, kids[0] ?? '') ??
          (kids[0] ?? '').split('.').pop() ??
          '';
        parts.push(`initial: ${str(initKey)}`);
      }
      const inner = kids.map((kid) => renderNode(kid, `${indent}    `)).join(',\n');
      parts.push(`states: {\n${inner}\n${indent}  }`);
      return `${indent}${key(label)}: {\n${parts.map((p) => `${indent}  ${p}`).join(',\n')}\n${indent}}`;
    }
    if (finals.has(path)) parts.push(`type: 'final'`);
    if (parts.length === 0) return `${indent}${key(label)}: {}`;
    return `${indent}${key(label)}: { ${parts.join(', ')} }`;
  };

  const stateLines = (childrenOf.get('') ?? []).map((top) => renderNode(top, '    '));

  const lines = [
    "import { createMachine } from 'xstate';",
    '',
    `export const ${machine.name}Machine = createMachine({`,
    `  id: ${str(machine.name)},`,
  ];
  if (machine.initial) {
    const rootInitial = hierarchical
      ? (machine.initial.split('.')[0] ?? machine.initial)
      : machine.initial;
    lines.push(`  initial: ${str(rootInitial)},`);
  }
  lines.push('  states: {');
  lines.push(stateLines.join(',\n'));
  lines.push('  }');
  lines.push('});');
  return lines.join('\n');
}
