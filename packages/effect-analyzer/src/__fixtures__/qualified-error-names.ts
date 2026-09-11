import * as Effect from 'effect/Effect';

/**
 * A namespace-qualified error type. The checker prints this member as
 * `Cause.NoSuchElementError`, which is also how Effect 3's
 * `declare namespace Cause` surfaces — so it exercises the spelling the
 * fixed-tag match has to survive.
 */
export declare namespace Cause {
  class NoSuchElementError {
    readonly _tag: 'NoSuchElementError';
  }
}

export class RateError {
  readonly _tag = 'RateError';
}

declare const lookup: () => Effect.Effect<number, RateError | Cause.NoSuchElementError>;

export const withNoSuchElement = Effect.gen(function* () {
  return yield* lookup().pipe(Effect.catchNoSuchElement);
});
