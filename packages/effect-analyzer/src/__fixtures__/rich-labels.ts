/**
 * Fixture exercising all rich label scenarios for Mermaid output.
 */
import { Effect, Context } from 'effect';

// Service definition
export class UserRepo extends Context.Tag('UserRepo')<
  UserRepo,
  {
    readonly getById: (id: string) => Effect.Effect<{ name: string }, { _tag: 'NotFound' }>;
  }
>() {}

export class Logger extends Context.Tag('Logger')<
  Logger,
  {
    readonly info: (msg: string) => Effect.Effect<void>;
  }
>() {}

// Generator with variable names and service calls
export const richProgram = Effect.gen(function* () {
  const logger = yield* Logger;
  const repo = yield* UserRepo;
  yield* logger.info('Starting');
  const user = yield* repo.getById('123');
  yield* Effect.log(`Found user: ${user.name}`);
  return user;
}).pipe(
  Effect.catchTag('NotFound', () => Effect.succeed({ name: 'default' }))
);

// Parallel with named children
export const parallelProgram = Effect.gen(function* () {
  const [a, b] = yield* Effect.all([
    Effect.succeed(1),
    Effect.succeed(2),
  ]);
  return a + b;
});

// Conditional
export const conditionalProgram = Effect.gen(function* () {
  const value = yield* Effect.succeed(true);
  yield* Effect.if(value, {
    onTrue: () => Effect.log('yes'),
    onFalse: () => Effect.log('no'),
  });
});
