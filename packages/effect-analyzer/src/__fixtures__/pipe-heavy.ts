/**
 * Pipe-heavy fixture without Effect.gen at the root.
 */

import { Effect } from 'effect';
import { pipe } from 'effect/Function';

const base = Effect.succeed({ value: 2 });

export const pipeHeavyProgram = pipe(
  base,
  Effect.tap(() => Effect.log('start')),
  Effect.map((x) => ({ value: x.value * 5 })),
  Effect.flatMap((x) =>
    x.value > 5 ? Effect.succeed(x) : Effect.fail(new Error('TooSmall')),
  ),
  Effect.tap(() => Effect.log('after flatMap')),
  Effect.catchAll(() => Effect.succeed({ value: 0 })),
  Effect.map((x) => x.value),
);

export const main = pipeHeavyProgram;
