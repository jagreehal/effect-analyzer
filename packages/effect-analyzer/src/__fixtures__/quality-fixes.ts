import { Effect, Schema, pipe } from 'effect';

// Issue 1: Schema.decodeUnknown should NOT be parsed as a loop node
export const UserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
});

export const validateUser = (input: unknown) =>
  Effect.gen(function* () {
    const user = yield* Schema.decodeUnknown(UserSchema)(input);
    return user;
  });

/** Schema.decode (vs decodeUnknown) — should not become a loop */
export const validateUserDecode = (input: unknown) =>
  Effect.gen(function* () {
    const user = yield* Schema.decode(UserSchema)(input);
    return user;
  });

// Issue 2: yield* calls should produce named steps
export const namedStepsProgram = Effect.gen(function* () {
  const config = yield* Effect.succeed({ url: 'http://api.example.com' });
  const response = yield* Effect.tryPromise(() => fetch(config.url));
  const data = yield* Effect.tryPromise(() => response.json());
  return data;
});

// Issue 3: Effect.withSpan should annotate parent, not create separate node
export const spanAnnotatedProgram = Effect.gen(function* () {
  const result = yield* Effect.succeed(42).pipe(Effect.withSpan('my-operation'));
  return result;
});

// Issue 5: Verbose labels should be truncated
export const verboseLabelsProgram = Effect.gen(function* () {
  const result = yield* Effect.succeed({
    amount: 100,
    currency: 'USD',
    rate: 1.5,
    description: 'test transaction',
    metadata: { key: 'value' },
  });
  return result;
});

/** Multiple withSpan layers on one pipe — observability without orphan withSpan nodes */
export const chainedWithSpanProgram = Effect.gen(function* () {
  const x = yield* pipe(
    Effect.succeed(1),
    Effect.withSpan('outer'),
    Effect.withSpan('inner'),
  );
  return x;
});

/** Sequential yields each with their own span */
export const multiSpanProgram = Effect.gen(function* () {
  const a = yield* Effect.succeed(1).pipe(Effect.withSpan('step-a'));
  const b = yield* Effect.succeed(a + 1).pipe(Effect.withSpan('step-b'));
  return b;
});
