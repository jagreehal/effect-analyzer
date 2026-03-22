/**
 * CLI-style Effect program fixture.
 *
 * Tests:
 * - simple script composition
 * - try/catch wrapping via Effect.try
 * - top-level main export with pipe-based recovery
 */

import { Effect } from 'effect';
import { pipe } from 'effect/Function';

const parseEmailArg = Effect.sync(() => {
  const email = process.argv[2] ?? 'test@example.com';
  if (!email.includes('@')) {
    throw new Error(`Invalid email: ${email}`);
  }
  return email;
});

const createUser = (email: string) =>
  Effect.succeed({
    id: 'u-1',
    email,
  });

export const cliMain = pipe(
  Effect.gen(function* () {
    const email = yield* Effect.try({
      try: () => Effect.runSync(parseEmailArg),
      catch: (error) => new Error(`Argument parse failed: ${String(error)}`),
    });
    const user = yield* createUser(email);
    yield* Effect.log(`Created user ${user.id}`);
    return user;
  }),
  Effect.catchAll((error) =>
    Effect.succeed({
      id: 'fallback',
      email: `error:${String(error)}`,
    }),
  ),
);

export const main = cliMain;
