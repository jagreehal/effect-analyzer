import { join } from 'node:path';
import { Project } from 'ts-morph';
import { describe, expect, it, vi } from 'vitest';
import { analyzeStateMachines } from './state-machine';
import { renderStatechartMermaid } from './output/mermaid-statechart';
import { renderStatechartSVG } from './output/svg-statechart';
import { renderXStateConfig } from './output/xstate-config';

const fixture = join(__dirname, '__fixtures__', 'state-machine.ts');
vi.setConfig({ testTimeout: 15_000 });
const advancedFixture = join(
  __dirname,
  '__fixtures__',
  'state-machine-advanced.ts',
);

describe('analyzeStateMachines', () => {
  it('extracts both machines from the fixture', () => {
    const { machines } = analyzeStateMachines(fixture);
    expect(machines.map((m) => m.name).sort()).toEqual([
      'docTransition',
      'supportTransitions',
    ]);
  });

  it('extracts triples from the declarative transition table', () => {
    const { machines } = analyzeStateMachines(fixture);
    const support = machines.find((m) => m.name === 'supportTransitions');
    expect(support?.source).toBe('transition-table');
    expect(support?.initial).toBe('Triage');
    expect(support?.transitions).toContainEqual({
      from: 'Triage',
      event: 'RefundRequested',
      to: 'Refund',
    });
    expect(support?.transitions).toContainEqual({
      from: 'Refund',
      event: 'Resolved',
      to: 'Answered',
    });
  });

  it('extracts triples from the Match.when tuple function', () => {
    const { machines } = analyzeStateMachines(fixture);
    const doc = machines.find((m) => m.name === 'docTransition');
    expect(doc?.source).toBe('match');
    expect(doc?.transitions).toContainEqual({
      from: 'Draft',
      event: 'Submit',
      to: 'Review',
    });
    expect(doc?.transitions).toContainEqual({
      from: 'Review',
      event: 'Reject',
      to: 'Draft',
    });
  });
});

describe('hardened detection', () => {
  it('reads block-body Match.when handlers', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition');
    expect(job?.transitions).toContainEqual({
      from: 'Queued',
      event: 'Start',
      to: 'Running',
    });
    expect(job?.transitions).toContainEqual({
      from: 'Running',
      event: 'Error',
      to: 'Failed',
    });
  });

  it('emits one edge per target for a guarded (multi-return) handler', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition');
    const finishTargets = job?.transitions
      .filter((t) => t.from === 'Running' && t.event === 'Finish')
      .map((t) => t.to)
      .sort();
    expect(finishTargets).toEqual(['Done', 'Failed']);
  });

  it('picks initial from a sibling initial declaration', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition');
    expect(job?.initial).toBe('Queued');
  });

  it('honors an @initial annotation over the first table key', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const gate = machines.find((m) => m.name === 'gateTransitions');
    // first key is "Closed"; annotation overrides to "Open"
    expect(gate?.initial).toBe('Open');
  });
});

const literalFixture = join(__dirname, '__fixtures__', 'state-machine-literal.ts');
const effectIdiomsFixture = join(
  __dirname,
  '__fixtures__',
  'state-machine-effect-idioms.ts',
);
const importedTransitionFixture = join(
  __dirname,
  '__fixtures__',
  'state-machine-imported-transition.ts',
);

describe('detection depth', () => {
  it('extracts a string-literal-union machine (no _tag) with its alphabet', () => {
    const { machines } = analyzeStateMachines(literalFixture);
    const light = machines.find((m) => m.name === 'lightTransition');
    expect(light?.transitions).toContainEqual({
      from: 'Red',
      event: 'Tick',
      to: 'Green',
    });
    expect([...(light?.declaredStates ?? [])].sort()).toEqual([
      'Green',
      'Red',
      'Yellow',
    ]);
    expect(light?.declaredEvents).toEqual(['Tick']);
  });

  it('captures the guard condition on a conditional transition', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition');
    const done = job?.transitions.find(
      (t) => t.from === 'Running' && t.event === 'Finish' && t.to === 'Done',
    );
    const failed = job?.transitions.find(
      (t) => t.from === 'Running' && t.event === 'Finish' && t.to === 'Failed',
    );
    expect(done?.guard).toBe('Math.random() > 0.5');
    expect(failed?.guard).toBeUndefined();
  });

  it('renders guards in mermaid and xstate config', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition')!;
    expect(renderStatechartMermaid(job)).toContain(
      'Running --> Done: Finish [Math.random() > 0.5]',
    );
    const config = renderXStateConfig(job);
    expect(config).toContain(
      `Finish: [{ target: 'Done', guard: 'Math.random() > 0.5' }, { target: 'Failed' }]`,
    );
  });

  it('reads XState-style table leaves without requiring XState', () => {
    const { machines } = analyzeStateMachines(effectIdiomsFixture);
    const workflow = machines.find((m) => m.name === 'workflowTransitions');
    expect(workflow?.transitions).toContainEqual({
      from: 'Idle',
      event: 'Start',
      to: 'Active',
      guard: 'canStart',
    });
    expect(workflow?.transitions).toContainEqual({
      from: 'Active',
      event: 'Stop',
      to: 'Closed',
    });
    expect(workflow?.transitions).toContainEqual({
      from: 'Active',
      event: 'Fail',
      to: 'Closed',
      guard: 'isFatal',
    });
    expect(workflow?.transitions).toContainEqual({
      from: 'Active',
      event: 'Fail',
      to: 'Idle',
    });
  });

  it('extracts nested Match.tags state and event transitions', () => {
    const { machines } = analyzeStateMachines(effectIdiomsFixture);
    const tagged = machines.find((m) => m.name === 'taggedTransition');
    expect(tagged?.source).toBe('match');
    expect(tagged?.transitions).toEqual([
      { from: 'Idle', event: 'Start', to: 'Active' },
      { from: 'Active', event: 'Stop', to: 'Closed' },
      { from: 'Active', event: 'Fail', to: 'Idle' },
    ]);
  });

  it('does not treat plain Match.tags variant dispatch as a state machine', () => {
    const { machines } = analyzeStateMachines(effectIdiomsFixture);
    expect(machines.some((m) => m.name === 'plainVariantDispatch')).toBe(false);
  });
});

describe('declared alphabet', () => {
  it('reads the alphabet from a satisfies-typed transition table', () => {
    const { machines } = analyzeStateMachines(fixture);
    const support = machines.find((m) => m.name === 'supportTransitions');
    expect(support?.alphabetSource).toBe('tagged-union');
    expect([...(support?.declaredStates ?? [])].sort()).toEqual([
      'Answered',
      'Human',
      'Refund',
      'Triage',
    ]);
    expect([...(support?.declaredEvents ?? [])].sort()).toEqual([
      'AnswerRequested',
      'EscalationRequested',
      'RefundRequested',
      'Resolved',
    ]);
  });

  it('reads the alphabet from a Match transition function signature', () => {
    const { machines } = analyzeStateMachines(fixture);
    const doc = machines.find((m) => m.name === 'docTransition');
    expect([...(doc?.declaredStates ?? [])].sort()).toEqual([
      'Draft',
      'Published',
      'Review',
    ]);
    expect([...(doc?.declaredEvents ?? [])].sort()).toEqual([
      'Approve',
      'Reject',
      'Submit',
    ]);
  });

  it('classifies Schema.TaggedClass unions as schema alphabets', () => {
    const { machines } = analyzeStateMachines(effectIdiomsFixture);
    const workflow = machines.find((m) => m.name === 'workflowTransitions');
    expect(workflow?.alphabetSource).toBe('schema');
    expect([...(workflow?.declaredStates ?? [])].sort()).toEqual([
      'Active',
      'Closed',
      'Idle',
    ]);
    expect([...(workflow?.declaredEvents ?? [])].sort()).toEqual([
      'Fail',
      'Start',
      'Stop',
    ]);
  });

  it('leaves the alphabet undefined when there is no type to read', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const gate = machines.find((m) => m.name === 'gateTransitions');
    // gateTransitions uses `as const` with no `satisfies`, so no declared alphabet
    expect(gate?.declaredStates).toBeUndefined();
    expect(gate?.declaredEvents).toBeUndefined();
  });
});

describe('hierarchy and automatic transitions', () => {
  const player = (): ReturnType<typeof analyzeStateMachines>['machines'][number] => {
    const { machines } = analyzeStateMachines(advancedFixture);
    return machines.find((m) => m.name === 'playerTransitions')!;
  };

  it('tags always/after table keys as automatic transitions', () => {
    const m = player();
    expect(m.transitions).toContainEqual({
      from: 'Loading',
      event: 'always',
      to: 'Playing.Running',
      guard: 'autoplay',
      trigger: 'always',
    });
    expect(m.transitions).toContainEqual({
      from: 'Playing.Running',
      event: 'after 5000ms',
      to: 'Stopped',
      trigger: 'after',
    });
    // ordinary events carry no trigger
    expect(
      m.transitions.find((t) => t.event === 'Ready')?.trigger,
    ).toBeUndefined();
  });

  it('renders dotted states as nested composites in mermaid', () => {
    const chart = renderStatechartMermaid(player());
    expect(chart).toContain('state Playing {');
    expect(chart).toContain('state "Running" as Playing_Running');
    expect(chart).toContain('state "Paused" as Playing_Paused');
    expect(chart).toContain('[*] --> Loading');
    expect(chart).toContain('Loading --> Playing_Running: always [autoplay]');
    expect(chart).toContain('Playing_Running --> Stopped: after 5000ms');
  });

  it('emits nested states, always/after keys, and absolute targets in xstate config', () => {
    const config = renderXStateConfig(player());
    expect(config).toContain(
      "always: [{ target: '#playerTransitions.Playing.Running', guard: 'autoplay' }]",
    );
    expect(config).toContain("after: { '5000': '#playerTransitions.Stopped' }");
    expect(config).toContain("initial: 'Running'");
    expect(config).toContain("Pause: '#playerTransitions.Playing.Paused'");
    expect(config).toContain("Stopped: { type: 'final' }");
    // nested Playing block with child states, not flat dotted keys
    expect(config).toMatch(/Playing: \{[\s\S]*states: \{[\s\S]*Running: \{/);
    expect(config).not.toContain("'Playing.Running':");

    // the emitted config parses as valid TypeScript
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('machine.ts', config);
    expect(
      project.getProgram().getSyntacticDiagnostics(sf).map((d) => d.getMessageText()),
    ).toEqual([]);
  });

  it('parses a dotted @initial annotation', () => {
    const source = `
      /** @initial Playing.Running */
      export const miniPlayer = {
        'Playing.Running': { Pause: 'Playing.Paused' },
        'Playing.Paused': { Play: 'Playing.Running' },
        Stopped: {},
      } as const;
    `;
    const { machines } = analyzeStateMachines('inline.ts', source);
    const m = machines.find((x) => x.name === 'miniPlayer');
    expect(m?.initial).toBe('Playing.Running');
    const config = renderXStateConfig(m!);
    expect(config).toContain("initial: 'Playing',");
  });

  it('reads new-expression targets from Schema.TaggedClass handlers', () => {
    const { machines } = analyzeStateMachines(effectIdiomsFixture);
    const tagged = machines.find((m) => m.name === 'taggedTransition');
    expect(tagged?.transitions).toContainEqual({
      from: 'Idle',
      event: 'Start',
      to: 'Active',
    });
  });

  it('reads actions, entry/exit, invoke, and explicit finals from a table', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const m = machines.find((x) => x.name === 'publishTransitions')!;
    expect(m.transitions).toContainEqual({
      from: 'Draft',
      event: 'Submit',
      to: 'Submitting',
      actions: ['persistDraft', 'recordSubmission'],
    });
    expect(m.transitions).toContainEqual({
      from: 'Submitting',
      event: 'onDone',
      to: 'Published',
      trigger: 'done',
      invokeIndex: 0,
    });
    expect(m.transitions).toContainEqual({
      from: 'Submitting',
      event: 'onError',
      to: 'Draft',
      guard: 'retryable',
      trigger: 'error',
      invokeIndex: 0,
    });
    expect(m.finalStates).toEqual(['Published']);
    expect(m.entryActions).toEqual({ Draft: ['enterDraft'] });
    expect(m.exitActions).toEqual({ Draft: ['persistDraft'] });
    expect(m.invokes).toEqual({ Submitting: [{ src: 'submitPayment' }] });
  });

  it('renders actions and invoke labels in mermaid and xstate config', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const m = machines.find((x) => x.name === 'publishTransitions')!;
    const chart = renderStatechartMermaid(m);
    expect(chart).toContain('Draft : entry / enterDraft');
    expect(chart).toContain('Draft : exit / persistDraft');
    expect(chart).toContain('Submitting : invoke submitPayment');
    expect(chart).toContain(
      'Draft --> Submitting: Submit / persistDraft, recordSubmission',
    );
    expect(chart).toContain('Published --> [*]');

    const config = renderXStateConfig(m);
    expect(config).toContain("entry: ['enterDraft']");
    expect(config).toContain("exit: ['persistDraft']");
    expect(config).toContain(
      "invoke: { src: 'submitPayment', onDone: 'Published', onError: [{ target: 'Draft', guard: 'retryable' }] }",
    );
    expect(config).toContain(
      "Submit: [{ target: 'Submitting', actions: ['persistDraft', 'recordSubmission'] }]",
    );
    expect(config).toContain("Published: { type: 'final' }");
  });

  it('resolves a new-expression target to the class tag, not the class name', () => {
    const source = `
      import { Match, Schema } from 'effect';
      class IdleState extends Schema.TaggedClass<IdleState>()('Idle', {}) {}
      class RunningState extends Schema.TaggedClass<RunningState>()('Running', {}) {}
      type S = IdleState | RunningState;
      type E = { readonly _tag: 'Start' };

      export const transition = (state: S, event: E): S =>
        Match.value([state._tag, event._tag] as const).pipe(
          Match.when(['Idle', 'Start'], () => new RunningState()),
          Match.orElse(() => state),
        );
    `;
    const { machines } = analyzeStateMachines('inline.ts', source);
    const m = machines.find((x) => x.name === 'transition');
    expect(m?.transitions).toContainEqual({
      from: 'Idle',
      event: 'Start',
      to: 'Running',
    });
    expect(m?.transitions.some((t) => t.to === 'RunningState')).toBe(false);
  });

  it('resolves an imported new-expression target through its _tag type', () => {
    const { machines } = analyzeStateMachines(importedTransitionFixture);
    const m = machines.find((x) => x.name === 'importedTransition');
    expect(m?.transitions).toContainEqual({
      from: 'Idle',
      event: 'Start',
      to: 'Running',
    });
    expect(m?.transitions.some((t) => t.to === 'RunningState')).toBe(false);
  });
});

describe('renderers', () => {
  it('renders a stateDiagram-v2', () => {
    const { machines } = analyzeStateMachines(fixture);
    const support = machines.find((m) => m.name === 'supportTransitions')!;
    const chart = renderStatechartMermaid(support);
    expect(chart).toContain('stateDiagram-v2');
    expect(chart).toContain('[*] --> Triage');
    expect(chart).toContain('Triage --> Refund: RefundRequested');
    expect(chart).toContain('Answered --> [*]');
  });

  it('emits a valid XState createMachine config', () => {
    const { machines } = analyzeStateMachines(fixture);
    const doc = machines.find((m) => m.name === 'docTransition')!;
    const config = renderXStateConfig(doc);
    expect(config).toContain("import { createMachine } from 'xstate'");
    expect(config).toContain("id: 'docTransition'");
    expect(config).toContain("initial: 'Draft'");
    expect(config).toContain("Draft: { on: { Submit: 'Review' } }");
    expect(config).toContain("Published: { type: 'final' }");
  });

  it('escapes string literal state and event names in XState config', () => {
    const source = `
      import { Match } from 'effect';
      type State = "Reader's Draft" | "Review";
      type Event = "Submit's Ready";

      export const copyTransition = (state: State, event: Event): State =>
        Match.value([state, event] as const).pipe(
          Match.when(["Reader's Draft", "Submit's Ready"], () => "Review" as const),
          Match.orElse(() => state),
        );
    `;
    const { machines } = analyzeStateMachines('inline.ts', source);
    const machine = machines.find((m) => m.name === 'copyTransition')!;
    const config = renderXStateConfig(machine);

    // The emitted config must be syntactically valid TypeScript even when state
    // or event names contain apostrophes.
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('machine.ts', config);
    const syntacticErrors = project
      .getProgram()
      .getSyntacticDiagnostics(sf)
      .map((d) => d.getMessageText());

    expect(syntacticErrors).toEqual([]);
    // sanity: the apostrophe state name made it through, properly escaped
    expect(config).toContain("Reader\\'s Draft");
  });

  it('emits a guarded transition as an array (no duplicate event keys)', () => {
    const { machines } = analyzeStateMachines(advancedFixture);
    const job = machines.find((m) => m.name === 'jobTransition')!;
    const config = renderXStateConfig(job);
    expect(config).toContain(
      `Running: { on: { Finish: [{ target: 'Done', guard: 'Math.random() > 0.5' }, { target: 'Failed' }], Error: 'Failed' } }`,
    );
    // never emit a duplicate object key
    expect(config).not.toMatch(/Finish:.*Finish:/);
  });

  it('renders a self-contained SVG statechart', () => {
    const { machines } = analyzeStateMachines(fixture);
    const support = machines.find((m) => m.name === 'supportTransitions')!;
    const svg = renderStatechartSVG(support);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    // event pill text and state labels are present
    expect(svg).toContain('RefundRequested');
    expect(svg).toContain('Triage');
  });
});
