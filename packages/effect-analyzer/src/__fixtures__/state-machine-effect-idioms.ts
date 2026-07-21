import { Match, Schema } from 'effect';

class Idle extends Schema.TaggedClass<Idle>()('Idle', {}) {}
class Active extends Schema.TaggedClass<Active>()('Active', {}) {}
class Closed extends Schema.TaggedClass<Closed>()('Closed', {}) {}

class Start extends Schema.TaggedClass<Start>()('Start', {}) {}
class Stop extends Schema.TaggedClass<Stop>()('Stop', {}) {}
class Fail extends Schema.TaggedClass<Fail>()('Fail', {}) {}

type WorkflowState = Idle | Active | Closed;
type WorkflowEvent = Start | Stop | Fail;
type WorkflowTarget =
  | WorkflowState['_tag']
  | { readonly target: WorkflowState['_tag']; readonly guard?: string }
  | { readonly to: WorkflowState['_tag'] }
  | readonly { readonly target: WorkflowState['_tag']; readonly guard?: string }[];

/** @initial Idle */
export const workflowTransitions = {
  Idle: {
    Start: { target: 'Active', guard: 'canStart' },
  },
  Active: {
    Stop: { to: 'Closed' },
    Fail: [{ target: 'Closed', guard: 'isFatal' }, { target: 'Idle' }],
  },
  Closed: {},
} as const satisfies Record<
  WorkflowState['_tag'],
  Partial<Record<WorkflowEvent['_tag'], WorkflowTarget>>
>;

// Nested Match dispatch: outer tags are states, inner tags are events. The
// outer matcher closes with `tagsExhaustive`; inner matchers close with
// `orElse` so unhandled events keep the current state.
export const taggedTransition = (
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Idle: () =>
        Match.value(event).pipe(
          Match.tags({
            Start: (): WorkflowState => new Active(),
          }),
          Match.orElse(() => state),
        ),
      Active: () =>
        Match.value(event).pipe(
          Match.tags({
            Stop: (): WorkflowState => new Closed(),
            Fail: (): WorkflowState => new Idle(),
          }),
          Match.orElse(() => state),
        ),
      Closed: () => state,
    }),
  );

export const plainVariantDispatch = (event: WorkflowEvent): string =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      Start: () => 'started',
      Stop: () => 'stopped',
      Fail: () => 'failed',
    }),
  );
