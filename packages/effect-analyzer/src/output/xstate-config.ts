/**
 * XState config emitter.
 *
 * Turns an extracted plain-Effect state machine into an XState v5
 * `createMachine({...})` config. The point: you write deterministic
 * Effect code (no XState), and this gives you a config you can paste
 * straight into the Stately visualizer (stately.ai/viz) to get the real
 * interactive statechart — for free.
 */

import type { StateMachine, StateTransition } from '../state-machine';

/** A single-quoted string literal, escaping backslashes and apostrophes. */
const str = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A safe JS identifier stays bare; anything else becomes a quoted string. */
function key(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : str(name);
}

export function renderXStateConfig(machine: StateMachine): string {
  const byFrom = new Map<string, StateTransition[]>();
  for (const state of machine.states) byFrom.set(state, []);
  for (const t of machine.transitions) byFrom.get(t.from)?.push(t);

  const stateLines = machine.states.map((state) => {
    const outs = byFrom.get(state) ?? [];
    if (outs.length === 0) {
      return `    ${key(state)}: { type: 'final' }`;
    }
    // Group targets by event. An event with multiple targets, or any guard, is
    // a conditional transition → emit an array of transition objects so the
    // config stays valid (no duplicate keys) and guards are preserved.
    const byEvent = new Map<string, { to: string; guard?: string }[]>();
    for (const t of outs) {
      const arr = byEvent.get(t.event) ?? [];
      if (!arr.some((x) => x.to === t.to && x.guard === t.guard)) {
        arr.push(t.guard === undefined ? { to: t.to } : { to: t.to, guard: t.guard });
      }
      byEvent.set(t.event, arr);
    }
    const transitionObj = (x: { to: string; guard?: string }): string =>
      x.guard === undefined
        ? `{ target: ${str(x.to)} }`
        : `{ target: ${str(x.to)}, guard: ${str(x.guard)} }`;
    const on = [...byEvent]
      .map(([event, targets]) => {
        const first = targets[0];
        return targets.length === 1 && first && first.guard === undefined
          ? `${key(event)}: ${str(first.to)}`
          : `${key(event)}: [${targets.map(transitionObj).join(', ')}]`;
      })
      .join(', ');
    return `    ${key(state)}: { on: { ${on} } }`;
  });

  const lines = [
    "import { createMachine } from 'xstate';",
    '',
    `export const ${machine.name}Machine = createMachine({`,
    `  id: ${str(machine.name)},`,
  ];
  if (machine.initial) lines.push(`  initial: ${str(machine.initial)},`);
  lines.push('  states: {');
  lines.push(stateLines.join(',\n'));
  lines.push('  }');
  lines.push('});');
  return lines.join('\n');
}
