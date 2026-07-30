/**
 * Fixture: machines written with `@typeonce/effect-machine` (the schema-first
 * Machine API from Effect PR #6429).
 *
 * `Checkout` is flat (atomic states, an invoke, a final state).
 * `Editor` is hierarchical (a parallel root with two compound regions).
 */

import { Machine } from '@typeonce/effect-machine';
import { Effect, Option, Schema } from 'effect';

// =============================================================================
// Checkout — flat machine with an invoke and a final state
// =============================================================================

class Idle extends Schema.TaggedClass<Idle>('Idle')('Idle', {}) {}
class Paying extends Schema.TaggedClass<Paying>('Paying')('Paying', {
  amount: Schema.Number,
}) {}
class Paid extends Schema.TaggedClass<Paid>('Paid')('Paid', {}) {}
class Failed extends Schema.TaggedClass<Failed>('Failed')('Failed', {}) {}

class Pay extends Schema.TaggedClass<Pay>('Pay')('Pay', {
  amount: Schema.Number,
}) {}
class Settled extends Schema.TaggedClass<Settled>('Settled')('Settled', {}) {}
class Cancel extends Schema.TaggedClass<Cancel>('Cancel')('Cancel', {}) {}

const ChargeCard = Machine.invoke({
  id: 'chargeCard',
  src: () => Machine.effect(Effect.succeed(new Settled())),
});

export const CheckoutStates = Machine.defineStates({
  Idle,
  Paying,
  Paid: { schema: Paid, type: 'final' },
  Failed,
});

export const CheckoutMachine = Machine.make({
  states: CheckoutStates.states,
  events: [Pay, Settled, Cancel],
  initial: () => CheckoutStates.initial.Idle(new Idle()),
}).handle({
  Idle: {
    on: {
      Pay: ({ event, target }) =>
        target.full.Paying(new Paying({ amount: event.amount })),
    },
  },
  Paying: {
    entry: () => Machine.action(Effect.log('charging')),
    invoke: () => ChargeCard,
    on: {
      Settled: ({ target }) => target.full.Paid(new Paid()),
      Cancel: ({ target }) => target.full.Failed(new Failed()),
    },
  },
});

// =============================================================================
// Order — deliberately incomplete: `Abandon` is never handled, `Cancelled` is
// never reached, and `Confirmed` is a dead end that is not marked final.
// =============================================================================

class Cart extends Schema.TaggedClass<Cart>('Cart')('Cart', {}) {}
class Payment extends Schema.TaggedClass<Payment>('Payment')('Payment', {}) {}
class Confirmed extends Schema.TaggedClass<Confirmed>('Confirmed')(
  'Confirmed',
  {},
) {}
class Cancelled extends Schema.TaggedClass<Cancelled>('Cancelled')(
  'Cancelled',
  {},
) {}

class Checkout extends Schema.TaggedClass<Checkout>('Checkout')(
  'Checkout',
  {},
) {}
class Confirm extends Schema.TaggedClass<Confirm>('Confirm')('Confirm', {}) {}
class Abandon extends Schema.TaggedClass<Abandon>('Abandon')('Abandon', {}) {}

export const OrderStates = Machine.defineStates({
  Cart,
  Payment,
  Confirmed,
  Cancelled,
});

export const OrderMachine = Machine.make({
  states: OrderStates.states,
  events: [Checkout, Confirm, Abandon],
  initial: () => OrderStates.initial.Cart(new Cart()),
}).handle({
  Cart: {
    on: {
      Checkout: ({ target }) => target.full.Payment(new Payment()),
    },
  },
  Payment: {
    on: {
      Confirm: ({ target }) => target.full.Confirmed(new Confirmed()),
    },
  },
});

// =============================================================================
// Editor — parallel root with two compound regions
// =============================================================================

class Workspace extends Schema.TaggedClass<Workspace>('Workspace')(
  'Workspace',
  {},
) {}
class Document extends Schema.TaggedClass<Document>('Document')('Document', {
  title: Schema.String,
}) {}
class Clean extends Schema.TaggedClass<Clean>('Clean')('Clean', {}) {}
class Dirty extends Schema.TaggedClass<Dirty>('Dirty')('Dirty', {}) {}
class Connection extends Schema.TaggedClass<Connection>('Connection')(
  'Connection',
  {},
) {}
class Online extends Schema.TaggedClass<Online>('Online')('Online', {}) {}
class Offline extends Schema.TaggedClass<Offline>('Offline')('Offline', {}) {}

class Edit extends Schema.TaggedClass<Edit>('Edit')('Edit', {}) {}
class Save extends Schema.TaggedClass<Save>('Save')('Save', {}) {}
class Disconnect extends Schema.TaggedClass<Disconnect>('Disconnect')(
  'Disconnect',
  {},
) {}
class Reconnect extends Schema.TaggedClass<Reconnect>('Reconnect')(
  'Reconnect',
  {},
) {}
class Rename extends Schema.TaggedClass<Rename>('Rename')('Rename', {
  title: Schema.String,
}) {}
class Reset extends Schema.TaggedClass<Reset>('Reset')('Reset', {}) {}
class Loaded extends Schema.TaggedClass<Loaded>('Loaded')('Loaded', {
  title: Schema.Option(Schema.String),
}) {}

export const EditorStates = Machine.defineStates({
  workspace: {
    schema: Workspace,
    type: 'parallel',
    states: {
      document: {
        schema: Document,
        initial: 'Clean',
        states: { Clean, Dirty },
      },
      connection: {
        schema: Connection,
        initial: 'Online',
        states: { Online, Offline },
      },
    },
  },
});

export const EditorMachine = Machine.make({
  states: EditorStates.states,
  events: [Edit, Save, Disconnect, Reconnect, Rename, Reset, Loaded],
  initial: () =>
    EditorStates.initial.workspace(new Workspace(), (workspace) =>
      workspace
        .document(new Document({ title: 'untitled' }), (document) =>
          document.Clean(new Clean()),
        )
        .connection(new Connection(), (connection) =>
          connection.Online(new Online()),
        ),
    ),
}).handle({
  workspace: {
    states: {
      document: {
        on: {
          Rename: {
            reenter: true,
            transition: ({ event, target }) =>
              target.local.with(new Document({ title: event.title }), (doc) =>
                doc.Dirty(new Dirty()),
              ),
          },
        },
        states: {
          Clean: {
            on: {
              Edit: ({ target }) => target.local.Dirty(new Dirty()),
              // Branching through Option.match: both arms are real targets, but
              // neither carries a condition the analyzer can read as a guard.
              Loaded: ({ event, target }) =>
                event.title.pipe(
                  Option.match({
                    onNone: () => target.local.Clean(new Clean()),
                    onSome: () => target.local.Dirty(new Dirty()),
                  }),
                ),
            },
          },
          Dirty: {
            exit: () => Machine.action(Effect.log('leaving dirty')),
            on: {
              Save: ({ target }) => target.local.Clean(new Clean()),
              // Re-enters every region of the parallel root, so the sound
              // target is the parent rather than any one leaf.
              Reset: ({ target }) =>
                target.full.workspace(new Workspace(), (workspace) =>
                  workspace
                    .document(new Document({ title: 'untitled' }), (document) =>
                      document.Clean(new Clean()),
                    )
                    .connection(new Connection(), (connection) =>
                      connection.Online(new Online()),
                    ),
                ),
            },
          },
        },
      },
      connection: {
        states: {
          Online: {
            on: {
              Disconnect: ({ target }) => target.local.Offline(new Offline()),
            },
          },
          Offline: {
            on: {
              Reconnect: ({ target }) => target.local.Online(new Online()),
            },
          },
        },
      },
    },
  },
});
