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

const fixtures = (name: string) => join(__dirname, '__fixtures__', name);
vi.setConfig({ testTimeout: 15_000 });

function coverageFor(file: string, machineName: string) {
  const { machines } = analyzeStateMachines(fixtures(file));
  const machine = machines.find((m) => m.name === machineName);
  if (!machine) throw new Error(`machine ${machineName} not found`);
  return computeStateMachineCoverage(machine);
}

describe('computeStateMachineCoverage', () => {
  it('flags unhandled events and unreachable states on an incomplete machine', () => {
    const cov = coverageFor('state-machine-schema.ts', 'checkoutTransition');
    expect(cov.alphabetKnown).toBe(true);
    expect(cov.alphabetSource).toBe('schema');
    expect(cov.unhandledEvents).toEqual(['Cancel']);
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
    const cov = coverageFor('state-machine-schema.ts', 'checkoutTransition');
    // active states {Cart, Payment} × 3 declared events = 6 possible pairs
    // handled: Cart→Checkout, Payment→Pay = 2
    expect(cov.totalPairs).toBe(6);
    expect(cov.handledPairs).toBe(2);
    expect(cov.coverageRatio).toBeCloseTo(2 / 6, 5);
  });

  it('reports a complete machine as having no warnings', () => {
    const cov = coverageFor('state-machine.ts', 'supportTransitions');
    expect(cov.alphabetKnown).toBe(true);
    expect(cov.unhandledEvents).toEqual([]);
    expect(cov.unreachableStates).toEqual([]);
    expect(cov.undeclaredStates).toEqual([]);
    expect(cov.undeclaredEvents).toEqual([]);
    expect(cov.findings.filter((f) => f.severity === 'warning')).toEqual([]);
  });

  it('degrades gracefully when the alphabet is unknown', () => {
    const cov = coverageFor('state-machine-advanced.ts', 'gateTransitions');
    expect(cov.alphabetKnown).toBe(false);
    // no declared alphabet ⇒ no unhandled/undeclared findings
    expect(cov.unhandledEvents).toEqual([]);
    expect(cov.undeclaredStates).toEqual([]);
    expect(cov.unreachableStates).toEqual([]);
  });

  it('does not report explicitly final states as dead ends', () => {
    const cov = coverageFor('state-machine-advanced.ts', 'publishTransitions');
    // Published is marked `type: 'final'` — intentional, not a dead end.
    expect(cov.deadEndStates).toEqual([]);
    expect(cov.findings.filter((f) => f.kind === 'dead-end-state')).toEqual([]);
  });
});

describe('coverage report + annotations', () => {
  it('renders a markdown report and flags warnings for CI', () => {
    const cov = coverageFor('state-machine-schema.ts', 'checkoutTransition');
    const report = renderCoverageReport([cov]);
    expect(report).toContain('# State machine coverage');
    expect(report).toContain('Unhandled events');
    expect(report).toContain('`Cancel`');
    expect(report).toContain('`Cancelled`');
    expect(hasCoverageWarnings([cov])).toBe(true);
  });

  it('reports no warnings for a complete machine', () => {
    const cov = coverageFor('state-machine.ts', 'supportTransitions');
    expect(renderCoverageReport([cov])).toContain('No completeness warnings');
    expect(hasCoverageWarnings([cov])).toBe(false);
  });

  it('annotates the mermaid statechart with a coverage note', () => {
    const { machines } = analyzeStateMachines(fixtures('state-machine-schema.ts'));
    const machine = machines.find((m) => m.name === 'checkoutTransition')!;
    const cov = computeStateMachineCoverage(machine);
    const mermaid = renderStatechartMermaid(machine, cov);
    expect(mermaid).toContain('note right of Cart');
    expect(mermaid).toContain('Unhandled events: Cancel');
    expect(mermaid).toContain('Unreachable states: Cancelled');
  });

  it('renders a summary table for multi-machine runs', () => {
    const { machines } = analyzeStateMachines(fixtures('state-machine.ts'));
    const covs = machines.map(computeStateMachineCoverage);
    const report = renderCoverageReport(covs);
    expect(report).toContain('| Machine | File | Coverage | Warnings |');
    expect(report).toContain('supportTransitions');
    expect(report).toContain('docTransition');
  });

  it('applies a minimum-coverage threshold', () => {
    const { machines } = analyzeStateMachines(fixtures('state-machine.ts'));
    const covs = machines.map(computeStateMachineCoverage);
    // docTransition is 50%, supportTransitions 42% — both below 60
    const summary = summarizeCoverage(covs, 60);
    expect(summary.passed).toBe(false);
    expect([...summary.belowThreshold].sort()).toEqual([
      'docTransition',
      'supportTransitions',
    ]);
    const report = renderCoverageReport(covs, { minCoverage: 60 });
    expect(report).toContain('Threshold: 60%');
    expect(report).toContain('below the 60% threshold');
  });

  it('passes the summary when everything is complete and above threshold', () => {
    const cov = coverageFor('state-machine.ts', 'supportTransitions');
    expect(summarizeCoverage([cov], 40).passed).toBe(true);
    expect(summarizeCoverage([cov]).passed).toBe(true);
  });

  it('annotates the SVG statechart with the orphan state and footer', () => {
    const { machines } = analyzeStateMachines(fixtures('state-machine-schema.ts'));
    const machine = machines.find((m) => m.name === 'checkoutTransition')!;
    const cov = computeStateMachineCoverage(machine);
    const svg = renderStatechartSVG(machine, cov);
    // orphan state is drawn (dashed) and the unhandled-events footer is present
    expect(svg).toContain('Cancelled');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('Unhandled events: Cancel');
  });

  it('renders a local visualizer page with SVG, coverage, and XState config', () => {
    const { machines } = analyzeStateMachines(fixtures('state-machine.ts'));
    const covs = machines.map(computeStateMachineCoverage);
    const html = renderStatechartVisualizerHTML(machines, covs);
    expect(html).toContain('<title>Effect Statecharts</title>');
    expect(html).toContain('Plain Effect source, XState-style visualization');
    expect(html).toContain('supportTransitions');
    expect(html).toContain('createMachine');
    expect(html).toContain('# State machine coverage');
  });

  it('folds a State Machines section into the colocated doc', async () => {
    const md = await Effect.runPromise(
      renderColocatedMarkdownForFile(
        [],
        'TB',
        true,
        undefined,
        false,
        fixtures('state-machine-schema.ts'),
      ),
    );
    expect(md).toContain('# State Machines');
    expect(md).toContain('## checkoutTransition');
    expect(md).toContain('alphabet: schema');
    expect(md).toContain('Coverage');
    expect(md).toContain('stateDiagram-v2');
    expect(md).toContain('Cancel');
  });
});
