/**
 * Schema-based state-machine fixture.
 *
 * The State/Event alphabets are declared with `effect/Schema` and the machine
 * is deliberately INCOMPLETE so coverage analysis has something to report:
 *  - `Cancel` is a declared event that no state handles  → unhandled event
 *  - `Cancelled` is a declared state nothing transitions to → unreachable state
 */

import { Match, Schema } from 'effect';

const CheckoutState = Schema.Union(
  Schema.TaggedStruct('Cart', {}),
  Schema.TaggedStruct('Payment', {}),
  Schema.TaggedStruct('Confirmed', {}),
  Schema.TaggedStruct('Cancelled', {}),
);
type CheckoutState = Schema.Schema.Type<typeof CheckoutState>;

const CheckoutEvent = Schema.Union(
  Schema.TaggedStruct('Checkout', {}),
  Schema.TaggedStruct('Pay', {}),
  Schema.TaggedStruct('Cancel', {}),
);
type CheckoutEvent = Schema.Schema.Type<typeof CheckoutEvent>;

export const checkoutTransition = (
  state: CheckoutState,
  event: CheckoutEvent,
): CheckoutState =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Cart', 'Checkout'], () => ({ _tag: 'Payment' as const })),
    Match.when(['Payment', 'Pay'], () => ({ _tag: 'Confirmed' as const })),
    Match.orElse(() => state),
  );
