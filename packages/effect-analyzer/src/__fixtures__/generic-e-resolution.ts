import { Effect, pipe } from 'effect';

/** Pipe + withSpan — outer inferred type may use generic error parameter. */
export const pipeWithSpan = pipe(Effect.succeed(1), Effect.withSpan('op'));

/** Curried withSpan applied to a concrete failure effect. */
const inner = Effect.fail('oops' as const);
export const curriedWithSpan = Effect.withSpan('x')(inner);
