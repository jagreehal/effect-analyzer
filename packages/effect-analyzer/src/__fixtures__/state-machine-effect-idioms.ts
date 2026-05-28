import { Match, Schema } from 'effect';

class Idle extends Schema.TaggedClass<Idle>()('Idle', {}) {}
class Active extends Schema.TaggedClass<Active>()('Active', {}) {}
class Closed extends Schema.TaggedClass<Closed>()('Closed', {}) {}

class Start extends Schema.TaggedRequest<Start>()('Start', {
  failure: Schema.Never,
  success: Schema.Void,
  payload: {},
}) {}
class Stop extends Schema.TaggedRequest<Stop>()('Stop', {
  failure: Schema.Never,
  success: Schema.Void,
  payload: {},
}) {}
class Fail extends Schema.TaggedRequest<Fail>()('Fail', {
  failure: Schema.Never,
  success: Schema.Void,
  payload: {},
}) {}

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

export const taggedTransition = (
  state: WorkflowState,
  event: WorkflowEvent,
): WorkflowState =>
  Match.value(state).pipe(
    Match.tags({
      Idle: () =>
        Match.value(event).pipe(
          Match.tags({
            Start: () => ({ _tag: 'Active' as const }),
          }),
        ),
      Active: () =>
        Match.value(event).pipe(
          Match.tags({
            Stop: () => ({ _tag: 'Closed' as const }),
            Fail: () => ({ _tag: 'Idle' as const }),
          }),
        ),
      Closed: () => state,
    }),
  );

export const plainVariantDispatch = (event: WorkflowEvent): string =>
  Match.value(event).pipe(
    Match.tags({
      Start: () => 'started',
      Stop: () => 'stopped',
      Fail: () => 'failed',
    }),
  );
