import { Context, Effect } from 'effect';

export class Refunds extends Context.Tag('Refunds')<
  Refunds,
  {
    readonly createRefund: (paymentId: string) => Effect.Effect<{ readonly refundId: string }>;
  }
>() {}

export class Notifications extends Context.Tag('Notifications')<
  Notifications,
  {
    readonly sendRefundEmail: (refundId: string) => Effect.Effect<void>;
  }
>() {}

export const refundMoney = (paymentId: string) =>
  Effect.gen(function* () {
    const refunds = yield* Refunds;
    const notifications = yield* Notifications;

    const refund = yield* refunds.createRefund(paymentId);
    yield* notifications.sendRefundEmail(refund.refundId);

    return refund;
  });
