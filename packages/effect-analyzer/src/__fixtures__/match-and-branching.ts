/**
 * Match/branching fixture for real-world control flow.
 */

import { Effect, Option } from 'effect';

const fetchMaybeUser = (id: string) =>
  Effect.succeed(
    id.startsWith('u-')
      ? Option.some({ id, email: `${id}@example.com` })
      : Option.none(),
  );

export const matchProgram = (id: string) =>
  fetchMaybeUser(id).pipe(
    Effect.flatMap((maybeUser) =>
      Option.isSome(maybeUser)
        ? Effect.succeed(maybeUser.value)
        : Effect.fail(new Error('NotFound')),
    ),
    Effect.match({
      onFailure: (_error) => ({ id: 'guest', email: 'guest@example.com' }),
      onSuccess: (user) => user,
    }),
  );

export const matchEffectProgram = (id: string) =>
  matchProgram(id).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.succeed({ status: 'failed', reason: String(error) }),
      onSuccess: (user) => Effect.succeed({ status: 'ok', userId: user.id }),
    }),
  );

export const branchingGenProgram = Effect.gen(function* () {
  const result = yield* matchEffectProgram('u-123');
  if (result.status === 'ok') {
    yield* Effect.log(`Matched user: ${result.userId}`);
  } else {
    yield* Effect.log(`Failure: ${result.reason}`);
  }
  return result;
});
