import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { analyzeStateMachines } from './state-machine';
import { renderColocatedMarkdownForFile } from './output/colocate';
import { computeStateMachineCoverage } from './state-machine-coverage';
import {
  renderCoverageReport,
  hasCoverageWarnings,
  summarizeCoverage,
} from './output/statechart-coverage';
import { renderStatechartMermaid } from './output/mermaid-statechart';
import { renderStatechartSVG } from './output/svg-statechart';
import { renderStatechartVisualizerHTML } from './output/statechart-html';

const fixture = join(__dirname, '__fixtures__', 'effect-machine.ts');
vi.setConfig({ testTimeout: 15_000 });

function machineNamed(name: string) {
  const machine = analyzeStateMachines(fixture).machines.find(
    (m) => m.name === name,
  );
  if (!machine) throw new Error(`machine ${name} not found`);
  return machine;
}

const coverageFor = (name: string) =>
  computeStateMachineCoverage(machineNamed(name));

describe('computeStateMachineCoverage', () => {
  it('flags unhandled events and unreachable states on an incomplete machine', () => {
    const cov = coverageFor('OrderMachine');
    expect(cov.alphabetKnown).toBe(true);
    expect(cov.alphabetSource).toBe('config');
    expect(cov.unhandledEvents).toEqual(['Abandon']);
    expect(cov.unreachableStates).toEqual(['Cancelled']);
    expect(cov.undeclaredStates).toEqual([]);
    expect(cov.undeclaredEvents).toEqual([]);
    expect(cov.deadEndStates).toEqual(['Confirmed']);

    const kinds = cov.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      'dead-end-state',
      'unhandled-event',
      'unreachable-state',
    ]);
  });

  it('computes a coverage ratio over reachable, non-final states', () => {
    const cov = coverageFor('OrderMachine');
    // active states {Cart, Payment} × 3 declared events = 6 possible pairs
    // handled: Cart→Checkout, Payment→Confirm = 2
    expect(cov.totalPairs).toBe(6);
    expect(cov.handledPairs).toBe(2);
    expect(cov.coverageRatio).toBeCloseTo(2 / 6, 5);
  });

  it('reports a complete machine as having no warnings', () => {
    const cov = coverageFor('CheckoutMachine');
    expect(cov.alphabetKnown).toBe(true);
    expect(cov.unhandledEvents).toEqual([]);
    expect(cov.unreachableStates).toEqual([]);
    expect(cov.undeclaredStates).toEqual([]);
    expect(cov.undeclaredEvents).toEqual([]);
    expect(cov.findings.filter((f) => f.severity === 'warning')).toEqual([]);
  });

  it('reaches every region of a parallel state', () => {
    const cov = coverageFor('EditorMachine');
    expect(cov.unreachableStates).toEqual([]);
  });

  it('degrades gracefully when the alphabet is unknown', () => {
    // A spread event list resolves to no identifiers, so no declared alphabet.
    const [machine] = analyzeStateMachines(
      '/virtual/spread.ts',
      `
      import { Machine } from '@typeonce/effect-machine';
      export const Relay = Machine.make({
        states: { Open, Closed },
        events: [...Child.emits],
        initial: () => S.initial.Open(new Open()),
      }).handle({
        Open: { on: { Shut: ({ target }) => target.full.Closed(new Closed()) } },
      });
    `,
    ).machines;
    const cov = computeStateMachineCoverage(machine!);
    expect(cov.alphabetKnown).toBe(false);
    // no declared alphabet ⇒ no unhandled/undeclared findings
    expect(cov.unhandledEvents).toEqual([]);
    expect(cov.undeclaredStates).toEqual([]);
    expect(cov.unreachableStates).toEqual([]);
  });

  it('does not report explicitly final states as dead ends', () => {
    // Paid is marked `type: 'final'` — intentional, not a dead end.
    expect(coverageFor('CheckoutMachine').deadEndStates).toEqual(['Failed']);
  });
});

describe('coverage report + annotations', () => {
  it('renders a markdown report and flags warnings for CI', () => {
    const cov = coverageFor('OrderMachine');
    const report = renderCoverageReport([cov]);
    expect(report).toContain('# State machine coverage');
    expect(report).toContain('Unhandled events');
    expect(report).toContain('`Abandon`');
    expect(report).toContain('`Cancelled`');
    expect(hasCoverageWarnings([cov])).toBe(true);
  });

  it('reports no warnings for a complete machine', () => {
    const cov = coverageFor('CheckoutMachine');
    expect(renderCoverageReport([cov])).toContain('No completeness warnings');
    expect(hasCoverageWarnings([cov])).toBe(false);
  });

  it('annotates the mermaid statechart with a coverage note', () => {
    const machine = machineNamed('OrderMachine');
    const cov = computeStateMachineCoverage(machine);
    const mermaid = renderStatechartMermaid(machine, cov);
    expect(mermaid).toContain('note right of Cart');
    expect(mermaid).toContain('Unhandled events: Abandon');
    // Declared states are always drawn, so the orphan is styled inline.
    expect(mermaid).toContain('class Cancelled unreachable');
  });

  it('renders a summary table for multi-machine runs', () => {
    const { machines } = analyzeStateMachines(fixture);
    const report = renderCoverageReport(machines.map(computeStateMachineCoverage));
    expect(report).toContain('| Machine | File | Coverage | Warnings |');
    expect(report).toContain('CheckoutMachine');
    expect(report).toContain('OrderMachine');
  });

  it('applies a minimum-coverage threshold', () => {
    const covs = ['CheckoutMachine', 'OrderMachine'].map(coverageFor);
    // CheckoutMachine is 50%, OrderMachine 33% — both below 60
    const summary = summarizeCoverage(covs, 60);
    expect(summary.passed).toBe(false);
    expect([...summary.belowThreshold].sort()).toEqual([
      'CheckoutMachine',
      'OrderMachine',
    ]);
    const report = renderCoverageReport(covs, { minCoverage: 60 });
    expect(report).toContain('Threshold: 60%');
    expect(report).toContain('below the 60% threshold');
  });

  it('passes the summary when everything is complete and above threshold', () => {
    const cov = coverageFor('CheckoutMachine');
    expect(summarizeCoverage([cov], 40).passed).toBe(true);
    expect(summarizeCoverage([cov]).passed).toBe(true);
  });

  it('annotates the SVG statechart with the orphan state and footer', () => {
    const machine = machineNamed('OrderMachine');
    const svg = renderStatechartSVG(machine, computeStateMachineCoverage(machine));
    // orphan state is drawn (dashed) and the unhandled-events footer is present
    expect(svg).toContain('Cancelled');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('Unhandled events: Abandon');
  });

  it('renders a local visualizer page with SVG, coverage, and XState config', () => {
    const { machines } = analyzeStateMachines(fixture);
    const html = renderStatechartVisualizerHTML(
      machines,
      machines.map(computeStateMachineCoverage),
    );
    expect(html).toContain('<title>Effect Statecharts</title>');
    expect(html).toContain('CheckoutMachine');
    expect(html).toContain('createMachine');
    expect(html).toContain('# State machine coverage');
  });

  it('folds a State Machines section into the colocated doc', async () => {
    const md = await Effect.runPromise(
      renderColocatedMarkdownForFile([], 'TB', true, undefined, false, fixture),
    );
    expect(md).toContain('# State Machines');
    expect(md).toContain('## OrderMachine');
    expect(md).toContain('alphabet: config');
    expect(md).toContain('Coverage');
    expect(md).toContain('stateDiagram-v2');
    expect(md).toContain('Abandon');
  });
});
