/**
 * Fixture: machines written with `@typeonce/effect-machine` >= 0.6 — the
 * `Machine.states` / `Machine.events` descriptor API that replaced
 * `Machine.defineStates` and the `[Event]` array alphabet.
 *
 * The 0.5-era shapes live in `effect-machine.ts`; both are supported.
 */

import { Effect, Schema } from 'effect';
import { Machine } from '@typeonce/effect-machine';

// =============================================================================
// Checkout — flat machine with an invoke and a final state
// =============================================================================

const CheckoutState = Schema.TaggedUnion({
  Paying: { amount: Schema.Number },
});

export const CheckoutStates = Machine.states({
  Idle: {},
  Paying: CheckoutState.cases.Paying,
  Paid: { type: 'final' },
  Failed: {},
});

export const CheckoutEvents = Machine.events(
  Schema.TaggedUnion({
    Pay: { amount: Schema.Number },
    Cancel: {},
  }),
);

const logCharge = () => undefined;
declare const chargeCard: (amount: number) => Effect.Effect<void, Error>;

export const CheckoutMachine = Machine.make({
  id: 'Checkout',
  states: CheckoutStates.states,
  events: CheckoutEvents,
  initial: (to) => to.Idle(),
}).handle({
  Idle: {
    on: {
      Pay: (to) =>
        to.full.Paying().resolve(({ event, target }) => target.from({ amount: event.amount })),
    },
  },
  Paying: {
    entry: logCharge,
    invoke: (from) =>
      from
        .effect('charge-card', ({ state }) => chargeCard(state.amount))
        .onDone((to) => to.full.Paid())
        .onFailure((to) => to.full.Failed()),
    on: {
      Cancel: (to) => to.full.Failed(),
    },
  },
});

// =============================================================================
// Editor — parallel root with two compound regions
// =============================================================================

const EditorState = Schema.TaggedUnion({
  Document: { title: Schema.String },
});

export const EditorStates = Machine.states({
  workspace: {
    type: 'parallel',
    states: {
      document: {
        schema: EditorState.cases.Document,
        initial: 'Clean',
        states: { Clean: {}, Dirty: {} },
      },
      connection: {
        initial: 'Online',
        states: { Online: {}, Offline: {} },
      },
    },
  },
});

export const EditorEvents = Machine.events(
  Schema.TaggedUnion({
    Edit: {},
    Save: {},
    Disconnect: {},
    Reconnect: {},
  }),
);

export const EditorMachine = Machine.make({
  states: EditorStates.states,
  events: EditorEvents,
  initial: (to) =>
    to.workspace.initial.resolve(({ target }) =>
      target.from((workspace) =>
        workspace
          .document.from({ title: 'untitled' }, (document) => document.Clean.from())
          .connection.from((connection) => connection.Online.from()),
      ),
    ),
}).handle({
  workspace: {
    states: {
      document: {
        states: {
          Clean: {
            on: { Edit: (to) => to.local.Dirty() },
          },
          Dirty: {
            exit: () => {},
            on: { Save: (to) => to.local.Clean() },
          },
        },
      },
      connection: {
        states: {
          Online: {
            on: { Disconnect: (to) => to.local.Offline() },
          },
          Offline: {
            on: { Reconnect: (to) => to.local.Online() },
          },
        },
      },
    },
  },
});

// =============================================================================
// Order — deliberately incomplete: `Abandon` is never handled, `Cancelled` is
// never reached, and `Confirmed` is a dead end that is not marked final.
// `Cart` is declared second, so `initial` cannot be inferred by position.
// =============================================================================

export const OrderStates = Machine.states({
  Cancelled: {},
  Cart: {},
  Payment: {},
  Confirmed: {},
});

export const OrderEvents = Machine.events(
  Schema.TaggedUnion({ Checkout: {}, Confirm: {}, Abandon: {} }),
);

export const OrderMachine = Machine.make({
  states: OrderStates.states,
  events: OrderEvents,
  initial: (to) => to.Cart(),
}).handle({
  Cart: { on: { Checkout: (to) => to.full.Payment() } },
  Payment: { on: { Confirm: (to) => to.full.Confirmed() } },
  Confirmed: {},
  Cancelled: {},
});

// =============================================================================
// Toggle — one definition, two implementations. `.handle` is called on a stored
// definition rather than chained onto `Machine.make`.
// =============================================================================

export const ToggleStates = Machine.states({ Off: {}, On: {} });

export const ToggleEvents = Machine.events(
  Schema.TaggedUnion({ Flip: {}, Reset: {} }),
);

const ToggleDefinition = Machine.make({
  states: ToggleStates.states,
  events: ToggleEvents,
  initial: (to) => to.Off(),
});

export const ProductionToggle = ToggleDefinition.handle({
  Off: { on: { Flip: (to) => to.full.On() } },
  On: { on: { Flip: (to) => to.full.Off() } },
});

export const TestingToggle = ToggleDefinition.handle({
  Off: { on: { Flip: (to) => to.full.On() } },
  On: { on: { Reset: (to) => to.full.Off() } },
});

// =============================================================================
// Review — one event, several outcomes, selected through named branches
// =============================================================================

export const ReviewStates = Machine.states({
  Pending: {},
  Accepted: {},
  Rejected: {},
});

export const ReviewEvents = Machine.events(
  Schema.TaggedUnion({ Evaluate: { score: Schema.Number } }),
);

export const ReviewMachine = Machine.make({
  states: ReviewStates.states,
  events: ReviewEvents,
  initial: (to) => to.Pending(),
}).handle({
  Pending: {
    on: {
      Evaluate: (to) =>
        to
          .branches({
            accepted: { target: to.full.Accepted() },
            rejected: { target: to.full.Rejected() },
          })
          .resolve(({ event, select }) =>
            event.score >= 80 ? select.accepted.from() : select.rejected.from(),
          ),
    },
  },
  Accepted: {},
  Rejected: {},
});
