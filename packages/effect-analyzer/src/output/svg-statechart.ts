/**
 * Self-contained SVG statechart renderer, styled after the XState/Stately
 * visualizer: dark canvas, a machine-container box, an initial-state dot,
 * blue event "pills" on the edges, and a final-state marker.
 *
 * No external tooling — emits a standalone <svg> (optionally wrapped in HTML).
 * Layout is a layered left-to-right BFS from the initial state. Edges leaving
 * a hub fan out to separate lanes so their pills never overlap a node.
 */

import { finalStatesOf } from '../state-machine';
import type { StateMachine } from '../state-machine';
import type { StateMachineCoverage } from '../state-machine-coverage';

interface Box {
  readonly state: string;
  readonly layer: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const C = {
  bg: '#16191f',
  container: '#3a414d',
  title: '#e2e8f0',
  node: '#222831',
  nodeStroke: '#4a5568',
  initStroke: '#4299e1',
  text: '#e2e8f0',
  edge: '#8a93a2',
  pill: '#2b6cb0',
  pillText: '#ffffff',
  dot: '#cbd5e0',
  unreachable: '#e53e3e',
  undeclared: '#dd6b20',
  warnText: '#feb2b2',
} as const;

const NODE_H = 44;
const V_GAP = 30;
const MARGIN_X = 84;
const MARGIN_TOP = 58;
const MARGIN_BOTTOM = 70;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const nodeWidth = (label: string): number =>
  Math.max(76, Math.round(label.length * 7.6) + 30);

const pillWidth = (label: string): number => label.length * 6.6 + 18;

/** Event label, with a (truncated) guard condition appended when present. */
const eventLabel = (event: string, guard?: string): string => {
  if (!guard) return event;
  const g = guard.length > 18 ? `${guard.slice(0, 17)}…` : guard;
  return `${event} [${g}]`;
};

function assignLayers(
  machine: StateMachine,
  states: readonly string[],
): Map<string, number> {
  const layer = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of states) adj.set(s, []);
  for (const t of machine.transitions) adj.get(t.from)?.push(t.to);

  const init = machine.initial ?? states[0];
  const queue: string[] = [];
  if (init) {
    layer.set(init, 0);
    queue.push(init);
  }
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    if (u === undefined) continue;
    const lu = layer.get(u) ?? 0;
    for (const v of adj.get(u) ?? []) {
      if (!layer.has(v)) {
        layer.set(v, lu + 1);
        queue.push(v);
      }
    }
  }
  let maxLayer = 0;
  for (const l of layer.values()) maxLayer = Math.max(maxLayer, l);
  for (const s of states) {
    if (!layer.has(s)) layer.set(s, ++maxLayer);
  }
  return layer;
}

function pill(cx: number, cy: number, label: string): string {
  const w = pillWidth(label);
  const h = 19;
  return (
    `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="9.5" fill="${C.pill}"/>` +
    `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.pillText}">${esc(label)}</text>`
  );
}

export function renderStatechartSVG(
  machine: StateMachine,
  coverage?: StateMachineCoverage,
): string {
  const unreachableSet = new Set(coverage?.unreachableStates ?? []);
  const undeclaredSet = new Set(coverage?.undeclaredStates ?? []);
  // Include declared-but-orphaned states so coverage gaps are visible.
  const states = [
    ...machine.states,
    ...(coverage?.unreachableStates ?? []).filter(
      (s) => !machine.states.includes(s),
    ),
  ];

  const layer = assignLayers(machine, states);
  let maxLayer = 0;
  for (const l of layer.values()) maxLayer = Math.max(maxLayer, l);

  const byLayer: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const s of states) byLayer[layer.get(s) ?? 0]?.push(s);

  // Horizontal gap must fit the widest event pill plus routing slack.
  const widestPill = Math.max(
    40,
    ...machine.transitions.map((t) => pillWidth(eventLabel(t.event, t.guard))),
  );
  const hGap = Math.round(widestPill + 56);

  const colW = byLayer.map((states) => Math.max(76, ...states.map(nodeWidth)));
  const colX: number[] = [];
  let cx = MARGIN_X;
  for (let i = 0; i <= maxLayer; i++) {
    colX[i] = cx;
    cx += (colW[i] ?? 76) + hGap;
  }

  const boxes = new Map<string, Box>();
  for (let l = 0; l <= maxLayer; l++) {
    (byLayer[l] ?? []).forEach((s, idx) => {
      const w = nodeWidth(s);
      const x = (colX[l] ?? MARGIN_X) + ((colW[l] ?? 76) - w) / 2;
      const y = MARGIN_TOP + idx * (NODE_H + V_GAP);
      boxes.set(s, { state: s, layer: l, x, y, w, h: NODE_H });
    });
  }

  const maxRows = Math.max(1, ...byLayer.map((s) => s.length));
  const contentW = (colX[maxLayer] ?? MARGIN_X) + (colW[maxLayer] ?? 76) + MARGIN_X;
  const contentH =
    MARGIN_TOP + maxRows * (NODE_H + V_GAP) - V_GAP + MARGIN_BOTTOM;
  const dipY = contentH - 32;

  const finals = finalStatesOf(machine);
  const edges: string[] = [];
  const pills: string[] = [];

  // Forward edges fan out by source so lanes/pills don't collide.
  const forwardBySource = new Map<
    string,
    { event: string; to: string; guard: string | undefined }[]
  >();
  const otherEdges: {
    from: string;
    event: string;
    to: string;
    guard: string | undefined;
  }[] = [];
  for (const t of machine.transitions) {
    const from = boxes.get(t.from);
    const to = boxes.get(t.to);
    if (!from || !to) continue;
    if (to.layer > from.layer) {
      const arr = forwardBySource.get(t.from) ?? [];
      arr.push({ event: t.event, to: t.to, guard: t.guard });
      forwardBySource.set(t.from, arr);
    } else {
      otherEdges.push({ from: t.from, event: t.event, to: t.to, guard: t.guard });
    }
  }

  for (const [fromState, outs] of forwardBySource) {
    const from = boxes.get(fromState);
    if (!from) continue;
    const sx = from.x + from.w;
    const scy = from.y + from.h / 2;
    const k = outs.length;
    // sort by target vertical position for tidy fan
    outs.sort(
      (a, b) => (boxes.get(a.to)?.y ?? 0) - (boxes.get(b.to)?.y ?? 0),
    );
    outs.forEach((o, i) => {
      const to = boxes.get(o.to);
      if (!to) return;
      const label = eventLabel(o.event, o.guard);
      const exitY = scy + (i - (k - 1) / 2) * 19;
      const pillW = pillWidth(label);
      const pillCx = sx + pillW / 2 + 16;
      const bendX = sx + widestPill + 30 + i * 8; // staggered vertical lane
      const tx = to.x;
      const ty = to.y + to.h / 2;
      edges.push(
        `<path d="M ${sx} ${scy} L ${(sx + 10).toFixed(1)} ${exitY.toFixed(1)} ` +
          `L ${bendX.toFixed(1)} ${exitY.toFixed(1)} L ${bendX.toFixed(1)} ${ty} L ${tx} ${ty}" ` +
          `fill="none" stroke="${C.edge}" stroke-width="1.5" marker-end="url(#arrow)"/>`,
      );
      pills.push(pill(pillCx, exitY, label));
    });
  }

  // Edges that don't go to a later layer: route downward ones on the right
  // side (own lane each) and true back-edges under the diagram.
  let rightLane = 0;
  let backLane = 0;
  for (const o of otherEdges) {
    const from = boxes.get(o.from);
    const to = boxes.get(o.to);
    if (!from || !to) continue;
    if (to.y > from.y) {
      // downward (often same column): hug the right side in its own lane
      const sx = from.x + from.w;
      const sy = from.y + from.h / 2;
      const tx = to.x + to.w;
      const ty = to.y + to.h / 2;
      const laneX = Math.max(sx, tx) + 22 + rightLane * 20;
      rightLane++;
      edges.push(
        `<path d="M ${sx} ${sy} L ${laneX.toFixed(1)} ${sy} L ${laneX.toFixed(1)} ${ty} L ${tx} ${ty}" ` +
          `fill="none" stroke="${C.edge}" stroke-width="1.5" marker-end="url(#arrow)"/>`,
      );
      pills.push(pill(laneX, (sy + ty) / 2, eventLabel(o.event, o.guard)));
    } else {
      // back-edge: route under the diagram
      const sx = from.x + from.w / 2;
      const sy = from.y + from.h;
      const tx = to.x + to.w / 2;
      const ty = to.y + to.h;
      const lane = dipY - backLane * 18;
      backLane++;
      edges.push(
        `<path d="M ${sx} ${sy} L ${sx} ${lane} L ${tx} ${lane} L ${tx} ${ty}" ` +
          `fill="none" stroke="${C.edge}" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow)"/>`,
      );
      pills.push(pill((sx + tx) / 2, lane, eventLabel(o.event, o.guard)));
    }
  }

  const nodes: string[] = [];
  for (const box of boxes.values()) {
    const isInitial = box.state === machine.initial;
    const isFinal = finals.has(box.state);
    const isUnreachable = unreachableSet.has(box.state);
    const isUndeclared = undeclaredSet.has(box.state);
    const stroke = isUnreachable
      ? C.unreachable
      : isUndeclared
        ? C.undeclared
        : isInitial
          ? C.initStroke
          : C.nodeStroke;
    const sw = isInitial || isUnreachable || isUndeclared ? 2 : 1.4;
    const dash = isUnreachable ? ' stroke-dasharray="5 3"' : '';
    nodes.push(
      `<rect x="${box.x.toFixed(1)}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="${C.node}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`,
    );
    if (isFinal) {
      nodes.push(
        `<rect x="${(box.x + 4).toFixed(1)}" y="${box.y + 4}" width="${box.w - 8}" height="${box.h - 8}" rx="6" fill="none" stroke="${C.nodeStroke}" stroke-width="1.2"/>`,
      );
    }
    nodes.push(
      `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + box.h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="600" fill="${C.text}">${esc(box.state)}</text>`,
    );
  }

  let initialMarker = '';
  const initBox = machine.initial ? boxes.get(machine.initial) : undefined;
  if (initBox) {
    const cyN = initBox.y + initBox.h / 2;
    const dotX = initBox.x - 30;
    initialMarker =
      `<circle cx="${dotX}" cy="${cyN}" r="6.5" fill="${C.dot}"/>` +
      `<path d="M ${dotX + 7} ${cyN} L ${initBox.x} ${cyN}" stroke="${C.edge}" stroke-width="1.5" marker-end="url(#arrow)"/>`;
  }

  const unhandled = coverage?.unhandledEvents ?? [];
  const footerH = unhandled.length > 0 ? 26 : 0;

  const W = Math.round(contentW);
  const boxH = Math.round(contentH);
  const H = boxH + footerH;
  const footer =
    footerH > 0
      ? `<text x="26" y="${boxH + 16}" font-size="12" font-weight="600" fill="${C.warnText}">⚠ Unhandled events: ${esc(unhandled.join(', '))}</text>`
      : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">`,
    `  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${C.edge}"/></marker></defs>`,
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`,
    `  <rect x="12" y="26" width="${W - 24}" height="${boxH - 38}" rx="10" fill="none" stroke="${C.container}" stroke-width="1.5"/>`,
    `  <text x="26" y="20" font-size="13" font-weight="700" fill="${C.title}">${esc(machine.name)}</text>`,
    ...edges.map((e) => '  ' + e),
    initialMarker ? '  ' + initialMarker : '',
    ...nodes.map((n) => '  ' + n),
    ...pills.map((p) => '  ' + p),
    footer ? '  ' + footer : '',
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Wrap one or more SVG diagrams in a minimal dark HTML page (for viewing). */
export function renderStatechartHTML(svgs: readonly string[]): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<style>body{margin:0;background:${C.bg};display:flex;flex-direction:column;gap:24px;padding:24px;}</style>`,
    '</head><body>',
    ...svgs,
    '</body></html>',
  ].join('\n');
}
