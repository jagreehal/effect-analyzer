/**
 * Complex Effect composition patterns
 * 
 * This fixture tests:
 * - Deeply nested compositions
 * - Conditional logic (if/when/unless)
 * - Recursion and loops
 * - Complex error handling chains
 * - Parallel + sequential combinations
 */

import { Effect, Option, Either } from 'effect';

// =============================================================================
// Conditional Patterns
// =============================================================================

/**
 * Program with Effect.if - using lazy functions
 */
export const conditionalIfProgram = (condition: boolean) =>
  Effect.if(condition, {
    onTrue: () => Effect.succeed('Condition was true'),
    onFalse: () => Effect.succeed('Condition was false'),
  });

/**
 * Program with Effect.when
 */
export const conditionalWhenProgram = (shouldRun: boolean) =>
  Effect.gen(function* () {
    yield* Effect.log('Starting operation');
    
    const result = yield* Effect.succeed('optional value').pipe(
      Effect.when(() => shouldRun)
    );
    
    return result;
  });

/**
 * Program with Effect.unless
 */
export const conditionalUnlessProgram = (skip: boolean) =>
  Effect.gen(function* () {
    yield* Effect.log('Conditional execution');
    
    const result = yield* Effect.succeed('executed').pipe(
      Effect.unless(() => skip)
    );
    
    return result;
  });

/**
 * Complex conditional with nested logic
 */
export const complexConditionalProgram = (flags: { a: boolean; b: boolean }) =>
  Effect.gen(function* () {
    const resultA = yield* Effect.if(flags.a, {
      onTrue: () => Effect.gen(function* () {
        yield* Effect.log('Flag A is true');
        return yield* Effect.if(flags.b, {
          onTrue: () => Effect.succeed('Both A and B are true'),
          onFalse: () => Effect.succeed('Only A is true'),
        });
      }),
      onFalse: () => Effect.succeed('A is false'),
    });
    
    return resultA;
  });

// =============================================================================
// Loop and Recursion Patterns
// =============================================================================

/**
 * Program with Effect.loop - body returns Effect<void>
 */
export const loopProgram = Effect.loop(0, {
  while: (i) => i < 5,
  step: (i) => i + 1,
  body: (i) => Effect.log(`Iteration ${i}`).pipe(Effect.as(void 0)),
});

/**
 * Program with recursive Effect
 */
export const recursiveProgram = (n: number): Effect.Effect<number> =>
  Effect.gen(function* () {
    if (n <= 1) {
      return 1;
    }
    
    const prev = yield* recursiveProgram(n - 1);
    return n * prev;
  });

/**
 * Program with Effect.repeat
 */
export const repeatProgram = Effect.gen(function* () {
  let counter = 0;
  
  const result = yield* Effect.sync(() => {
    counter++;
    return counter;
  }).pipe(Effect.repeat({ times: 3 }));
  
  return result;
});

/**
 * Program with Effect.forEach and concurrency
 */
export const concurrentForEachProgram = (items: string[]) =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(items, (item) =>
      Effect.gen(function* () {
        yield* Effect.sleep('100 millis');
        return item.toUpperCase();
      }),
      { concurrency: 3 }
    );
    
    return results;
  });

// =============================================================================
// Complex Error Handling Chains
// =============================================================================

/**
 * Program with multiple error handlers chained
 */
export const chainedErrorHandlerProgram = Effect.gen(function* () {
  const result = yield* Effect.fail({ _tag: 'ErrorA' as const }).pipe(
    Effect.catchTag('ErrorA', () => Effect.fail({ _tag: 'ErrorB' as const })),
    Effect.catchTag('ErrorB', () => Effect.fail({ _tag: 'ErrorC' as const })),
    Effect.catchTag('ErrorC', () => Effect.succeed('Recovered from C'))
  );
  
  return result;
});

/**
 * Program with catchAllCause
 */
export const catchAllCauseProgram = Effect.gen(function* () {
  const result = yield* Effect.fail('error').pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.log(`Caught cause: ${String(cause)}`);
        return 'recovered';
      })
    )
  );
  
  return result;
});

/**
 * Program with tapError
 */
export const tapErrorProgram = Effect.gen(function* () {
  const result = yield* Effect.fail('error').pipe(
    Effect.tapError((error) => Effect.log(`Error occurred: ${error}`)),
    Effect.orElse(() => Effect.succeed('fallback'))
  );
  
  return result;
});

/**
 * Program with orElse and orElseFail
 */
export const orElseChainProgram = Effect.gen(function* () {
  const result = yield* Effect.fail('first').pipe(
    Effect.orElse(() => Effect.fail('second')),
    Effect.orElse(() => Effect.succeed('third succeeded'))
  );
  
  return result;
});

// =============================================================================
// Parallel + Sequential Combinations
// =============================================================================

/**
 * Complex program mixing parallel and sequential
 */
export const mixedParallelSequentialProgram = Effect.gen(function* () {
  // Sequential setup
  yield* Effect.log('Starting mixed program');
  
  // Parallel batch 1
  const [result1, result2] = yield* Effect.all([
    Effect.succeed('parallel-1'),
    Effect.succeed('parallel-2'),
  ]);
  
  // Sequential processing
  yield* Effect.log(`Got results: ${result1}, ${result2}`);
  
  // Parallel batch 2
  const [result3, result4, result5] = yield* Effect.all([
    Effect.succeed('parallel-3'),
    Effect.succeed('parallel-4'),
    Effect.succeed('parallel-5'),
  ]);
  
  // Final sequential step
  yield* Effect.log('All parallel batches completed');
  
  return [result1, result2, result3, result4, result5];
});

/**
 * Race with fallback
 */
export const raceWithFallbackProgram = Effect.gen(function* () {
  const fast = Effect.sleep('100 millis').pipe(Effect.as('fast'));
  const slow = Effect.sleep('500 millis').pipe(Effect.as('slow'));
  
  const winner = yield* Effect.race(fast, slow).pipe(
    Effect.orElse(() => Effect.succeed('neither won'))
  );
  
  return winner;
});

// =============================================================================
// Option and Either Integration
// =============================================================================

/**
 * Program converting Option to Effect using Option.match
 */
export const optionToEffectProgram = (maybeValue: Option.Option<string>) =>
  Effect.gen(function* () {
    const value = yield* Option.match(maybeValue, {
      onNone: () => Effect.succeed('default'),
      onSome: (v) => Effect.succeed(v),
    });
    
    return value;
  });

/**
 * Program converting Either to Effect using Either.match
 */
export const eitherToEffectProgram = (either: Either.Either<string, Error>) =>
  Effect.gen(function* () {
    const value = yield* Either.match(either, {
      onLeft: (error) => Effect.succeed(`Error: ${error.message}`),
      onRight: (str) => Effect.succeed(str),
    });
    
    return value;
  });

/**
 * Program with Option within Effect
 */
export const optionWithinEffectProgram = Effect.gen(function* () {
  const maybeNumber = Option.some(42);
  
  const result = yield* Option.match(maybeNumber, {
    onNone: () => Effect.succeed(0),
    onSome: (n) => Effect.succeed(n * 2),
  });
  
  return result;
});

// =============================================================================
// Array Operations
// =============================================================================

/**
 * Program with Array operations wrapped in Effect
 */
export const arrayOperationsProgram = (items: number[]) =>
  Effect.gen(function* () {
    // Standard array operations wrapped in Effect
    const doubled = items.map((n) => n * 2);
    const filtered = doubled.filter((n) => n > 5);
    const reduced = filtered.reduce((acc, n) => acc + n, 0);
    
    return reduced;
  });

export const main = complexConditionalProgram({ a: true, b: false });
