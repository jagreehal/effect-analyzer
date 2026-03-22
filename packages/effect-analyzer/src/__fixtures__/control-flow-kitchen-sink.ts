/**
 * KITCHEN SINK: Extreme control flow patterns inside Effect.gen generators.
 *
 * This fixture pushes every edge case of the static analyzer:
 * - Deeply nested control flow (if → switch → loop → try/catch)
 * - Expression-level branching (ternary, &&, ||, ??, nested ternary chains)
 * - All loop types with every feature (header yields, early exit, iterVariable)
 * - try/catch/finally in every combination with terminal interception
 * - Terminal nodes (return, throw) in every position
 * - Switch fallthrough groups, mixed terminators
 * - Yields in unusual positions (args, arrays, object literals, for-of initializer)
 * - Nested function boundaries (must not leak inner generator yields)
 * - Labeled statements for break targets
 * - Expression unwrapping (as, !, satisfies, parentheses)
 * - Real-world workflow patterns (checkout, payment, retry with fallback)
 */

import { Effect } from 'effect';

// ============================================================================
// 1. DEEPLY NESTED: if → switch → for-of → try/catch
// ============================================================================
export const deeplyNested = Effect.gen(function* () {
  const config = yield* Effect.succeed({ mode: 'advanced' as string, items: [1, 2, 3] });
  if (config.mode === 'advanced') {
    switch (config.mode) {
      case 'advanced':
        for (const item of config.items) {
          try {
            yield* Effect.succeed(`process:${item}`);
          } catch (e) {
            yield* Effect.succeed(`recover:${item}`);
          }
        }
        break;
      case 'simple':
        yield* Effect.succeed('simple-path');
        break;
    }
  } else {
    yield* Effect.succeed('basic-mode');
  }
});

// ============================================================================
// 2. NESTED TERNARY CHAIN (cascading decisions)
// ============================================================================
export const nestedTernary = Effect.gen(function* () {
  const tier = yield* Effect.succeed('gold' as string);
  const discount = tier === 'platinum'
    ? (yield* Effect.succeed(0.30))
    : tier === 'gold'
      ? (yield* Effect.succeed(0.20))
      : tier === 'silver'
        ? (yield* Effect.succeed(0.10))
        : (yield* Effect.succeed(0));
  return discount;
});

// ============================================================================
// 3. CHAINED SHORT-CIRCUIT with mixed && || ??
// ============================================================================
export const chainedShortCircuit = Effect.gen(function* () {
  const user = yield* Effect.succeed({ name: 'Alice' as string | null });
  // && short-circuit
  const greeting = user.name && (yield* Effect.succeed(`Hello, ${user.name}`));
  // || short-circuit
  const fallback = greeting || (yield* Effect.succeed('Hello, stranger'));
  // ?? nullish coalescing
  const cached: string | null = null;
  const result = cached ?? (yield* Effect.succeed('computed-value'));
  return result;
});

// ============================================================================
// 4. EVERY LOOP TYPE with yields + early exit + header yields
// ============================================================================
export const allLoopTypes = Effect.gen(function* () {
  // for-of with yield in iterable expression
  const items = yield* Effect.succeed([10, 20, 30]);
  for (const item of items) {
    yield* Effect.succeed(`forOf:${item}`);
  }

  // for-in
  const obj = { a: 1, b: 2 };
  for (const key in obj) {
    yield* Effect.succeed(`forIn:${key}`);
  }

  // classic for loop with yield
  for (let i = 0; i < 3; i++) {
    yield* Effect.succeed(`for:${i}`);
  }

  // while with early break
  let counter = 0;
  while (counter < 10) {
    yield* Effect.succeed(`while:${counter}`);
    if (counter === 2) break;
    counter++;
  }

  // do-while with early return
  let attempt = 0;
  do {
    const success = yield* Effect.succeed(attempt > 1);
    if (success) {
      return yield* Effect.succeed('do-while-exit');
    }
    attempt++;
  } while (attempt < 5);
});

// ============================================================================
// 5. TRY/CATCH MATRIX: all combinations
// ============================================================================
// try/catch only
export const tryCatchOnly = Effect.gen(function* () {
  try {
    yield* Effect.succeed('try-only');
  } catch {
    yield* Effect.succeed('catch-only');
  }
});

// try/finally only (no catch)
export const tryFinallyOnly = Effect.gen(function* () {
  try {
    yield* Effect.succeed('try-body');
  } finally {
    yield* Effect.succeed('finally-only');
  }
});

// try/catch/finally with return in try (terminal interception)
export const tryReturnFinally = Effect.gen(function* () {
  try {
    const data = yield* Effect.succeed('loaded');
    return data;
  } catch (err) {
    yield* Effect.succeed('error-logged');
    return 'fallback';
  } finally {
    yield* Effect.succeed('cleanup-always');
  }
});

// nested try/catch
export const nestedTryCatch = Effect.gen(function* () {
  try {
    try {
      yield* Effect.succeed('inner-try');
    } catch (innerErr) {
      yield* Effect.succeed('inner-catch');
      throw innerErr; // re-throw to outer
    }
  } catch (outerErr) {
    yield* Effect.succeed('outer-catch');
  } finally {
    yield* Effect.succeed('outer-finally');
  }
});

// try with throw in catch (re-throw pattern)
export const tryCatchRethrow = Effect.gen(function* () {
  try {
    yield* Effect.succeed('risky-operation');
  } catch (e) {
    yield* Effect.succeed('log-error');
    throw new Error(`wrapped: ${e}`);
  }
});

// ============================================================================
// 6. SWITCH FALLTHROUGH PATTERNS
// ============================================================================
// Mixed fallthrough: some cases fall through, some break, one returns
export const switchMixedTerminators = Effect.gen(function* () {
  const status = yield* Effect.succeed('pending' as string);
  switch (status) {
    case 'draft':
    case 'pending':
      yield* Effect.succeed('needs-review');
      break;
    case 'approved':
      yield* Effect.succeed('ready');
      // intentional fallthrough to 'published'
    case 'published':
      yield* Effect.succeed('visible');
      break;
    case 'archived':
      yield* Effect.succeed('cleanup');
      return yield* Effect.succeed('done');
    default:
      yield* Effect.succeed('unknown-status');
  }
});

// Switch with every case returning (no breaks needed)
export const switchAllReturns = Effect.gen(function* () {
  const code = yield* Effect.succeed(200 as number);
  switch (code) {
    case 200:
      return yield* Effect.succeed('ok');
    case 404:
      return yield* Effect.succeed('not-found');
    case 500:
      return yield* Effect.succeed('server-error');
    default:
      return yield* Effect.succeed('other');
  }
});

// ============================================================================
// 7. TERMINALS IN EVERY POSITION
// ============================================================================
// Return from inside nested if
export const returnFromNestedIf = Effect.gen(function* () {
  const user = yield* Effect.succeed({ active: true, premium: true });
  if (user.active) {
    if (user.premium) {
      return yield* Effect.succeed('premium-active');
    }
    yield* Effect.succeed('active-free');
  }
  return yield* Effect.succeed('inactive');
});

// Throw with yield value
export const throwWithYieldValue = Effect.gen(function* () {
  const isValid = yield* Effect.succeed(false);
  if (!isValid) {
    const msg = yield* Effect.succeed('Validation failed');
    throw new Error(msg);
  }
  yield* Effect.succeed('proceed');
});

// Multiple early returns (guard clauses pattern)
export const guardClauses = Effect.gen(function* () {
  const input = yield* Effect.succeed({ a: 1, b: 2, c: 3 });
  if (input.a <= 0) return yield* Effect.succeed('invalid-a');
  if (input.b <= 0) return yield* Effect.succeed('invalid-b');
  if (input.c <= 0) return yield* Effect.succeed('invalid-c');
  const result = yield* Effect.succeed(input.a + input.b + input.c);
  return result;
});

// ============================================================================
// 8. YIELDS IN UNUSUAL POSITIONS
// ============================================================================
export const yieldsInUnusualPositions = Effect.gen(function* () {
  // Yield in function argument
  const formatted = String(yield* Effect.succeed(42));

  // Yield in array literal
  const arr = [yield* Effect.succeed('first'), yield* Effect.succeed('second')];

  // Yield in object literal
  const obj = {
    key: yield* Effect.succeed('value'),
    nested: { inner: yield* Effect.succeed('deep') },
  };

  // Yield in template literal
  const msg = `Result: ${yield* Effect.succeed('computed')}`;

  return { formatted, arr, obj, msg };
});

// ============================================================================
// 9. EXPRESSION UNWRAPPING (as, !, satisfies, parens)
// ============================================================================
export const expressionUnwrapping = Effect.gen(function* () {
  // as assertion
  const typed = (yield* Effect.succeed('hello')) as string;
  // non-null assertion
  const nonNull = (yield* Effect.succeed('world' as string | null))!;
  // double parens
  const parens = ((yield* Effect.succeed(42)));
  // satisfies (TS 4.9+)
  const sat = (yield* Effect.succeed({ x: 1, y: 2 })) satisfies Record<string, number>;
  return { typed, nonNull, parens, sat };
});

// ============================================================================
// 10. NESTED FUNCTION BOUNDARY — inner yields must NOT leak
// ============================================================================
export const nestedFunctionBoundary = Effect.gen(function* () {
  yield* Effect.succeed('before-nested');

  // Arrow function with generator — NOT our scope
  const makeHelper = () => Effect.gen(function* () {
    yield* Effect.succeed('inner-arrow-gen-SHOULD-NOT-APPEAR');
  });

  // Regular function with generator — NOT our scope
  function createWorker() {
    return Effect.gen(function* () {
      yield* Effect.succeed('inner-fn-gen-SHOULD-NOT-APPEAR');
    });
  }

  // Method in object literal — NOT our scope
  const factory = {
    create: function* () {
      yield 'plain-yield-in-method-SHOULD-NOT-APPEAR';
    },
  };

  // Class with method — NOT our scope
  class Processor {
    *process() {
      yield 'class-method-SHOULD-NOT-APPEAR';
    }
  }

  yield* Effect.succeed('after-nested');
});

// ============================================================================
// 11. IF/ELSE CHAINS (else-if ladder)
// ============================================================================
export const ifElseChain = Effect.gen(function* () {
  const score = yield* Effect.succeed(85);
  if (score >= 90) {
    yield* Effect.succeed('grade-A');
  } else if (score >= 80) {
    yield* Effect.succeed('grade-B');
  } else if (score >= 70) {
    yield* Effect.succeed('grade-C');
  } else {
    yield* Effect.succeed('grade-F');
  }
});

// ============================================================================
// 12. LABELED STATEMENT with break
// ============================================================================
export const labeledBreak = Effect.gen(function* () {
  yield* Effect.succeed('start');
  outer: {
    const shouldSkip = yield* Effect.succeed(true);
    if (shouldSkip) {
      yield* Effect.succeed('breaking-out');
      break outer;
    }
    yield* Effect.succeed('skipped-by-break');
  }
  yield* Effect.succeed('after-label');
});

// ============================================================================
// 13. FOR-OF WITH YIELD* IN ITERABLE (header yield)
// ============================================================================
export const forOfHeaderYield = Effect.gen(function* () {
  for (const item of yield* Effect.succeed(['x', 'y', 'z'])) {
    yield* Effect.succeed(`process:${item}`);
  }
});

// ============================================================================
// 14. WHILE LOOP WITH COMPLEX CONDITION (yield in condition via variable)
// ============================================================================
export const whileComplexCondition = Effect.gen(function* () {
  let shouldContinue = yield* Effect.succeed(true);
  while (shouldContinue) {
    yield* Effect.succeed('iteration');
    shouldContinue = yield* Effect.succeed(false);
  }
});

// ============================================================================
// 15. SWITCH INSIDE LOOP WITH BREAK (break targets switch, not loop)
// ============================================================================
export const switchInsideLoop = Effect.gen(function* () {
  const commands = yield* Effect.succeed(['add', 'remove', 'quit', 'add']);
  for (const cmd of commands) {
    switch (cmd) {
      case 'add':
        yield* Effect.succeed('added');
        break; // breaks the switch, not the loop
      case 'remove':
        yield* Effect.succeed('removed');
        break;
      case 'quit':
        yield* Effect.succeed('quitting');
        return yield* Effect.succeed('exited-via-quit');
      default:
        yield* Effect.succeed('unknown-cmd');
    }
    yield* Effect.succeed('after-switch-in-loop');
  }
});

// ============================================================================
// 16. REAL-WORLD: Checkout workflow with retry, parallel, and error handling
// ============================================================================
export const checkoutWorkflow = Effect.gen(function* () {
  // Step 1: Validate
  const cart = yield* Effect.succeed({ items: [{ id: 1, qty: 2 }], userId: 'u1' });
  if (cart.items.length === 0) {
    return yield* Effect.succeed({ status: 'empty-cart' as const });
  }

  // Step 2: Parallel fetch (user + inventory)
  const [user, inventory] = yield* Effect.all([
    Effect.succeed({ id: 'u1', name: 'Alice', premium: true }),
    Effect.succeed({ available: true, reserved: false }),
  ]);

  // Step 3: Decision based on inventory
  if (!inventory.available) {
    return yield* Effect.succeed({ status: 'out-of-stock' as const });
  }

  // Step 4: Premium discount decision
  const price = user.premium
    ? (yield* Effect.succeed(80))
    : (yield* Effect.succeed(100));

  // Step 5: Payment with retry and error handling
  try {
    const payment = yield* Effect.succeed({ charged: true, amount: price });
    if (!payment.charged) {
      throw new Error('payment-failed');
    }

    // Step 6: Post-payment parallel operations
    yield* Effect.all([
      Effect.succeed('send-receipt'),
      Effect.succeed('update-inventory'),
      Effect.succeed('notify-warehouse'),
    ]);

    return yield* Effect.succeed({ status: 'completed' as const, amount: price });
  } catch (paymentErr) {
    yield* Effect.succeed('payment-error-logged');
    return yield* Effect.succeed({ status: 'payment-failed' as const });
  } finally {
    yield* Effect.succeed('release-lock');
  }
});

// ============================================================================
// 17. REAL-WORLD: Data pipeline with for-each, transform, and error boundaries
// ============================================================================
export const dataPipeline = Effect.gen(function* () {
  const rawData = yield* Effect.succeed([
    { id: 1, value: 'valid' },
    { id: 2, value: null },
    { id: 3, value: 'valid' },
  ]);

  const results: Array<{ id: number; processed: string }> = [];

  for (const record of rawData) {
    try {
      if (record.value === null) {
        yield* Effect.succeed(`skip-null:${record.id}`);
        continue; // skip invalid records
      }
      const transformed = yield* Effect.succeed(`transformed:${record.value}`);
      results.push({ id: record.id, processed: transformed });
    } catch (recordErr) {
      yield* Effect.succeed(`error-record:${record.id}`);
      // continue processing other records
    }
  }

  if (results.length === 0) {
    return yield* Effect.succeed({ status: 'no-valid-data' as const });
  }

  return yield* Effect.succeed({ status: 'success' as const, count: results.length });
});

// ============================================================================
// 18. REAL-WORLD: State machine with switch + loop
// ============================================================================
export const stateMachine = Effect.gen(function* () {
  let state = yield* Effect.succeed('idle' as string);
  let iterations = 0;

  while (state !== 'done' && iterations < 10) {
    switch (state) {
      case 'idle':
        yield* Effect.succeed('entering-active');
        state = 'active';
        break;
      case 'active': {
        const shouldPause = yield* Effect.succeed(iterations > 2);
        if (shouldPause) {
          yield* Effect.succeed('pausing');
          state = 'paused';
        } else {
          yield* Effect.succeed('processing');
        }
        break;
      }
      case 'paused':
        yield* Effect.succeed('resuming');
        state = 'active';
        break;
      case 'error':
        yield* Effect.succeed('recovering');
        state = 'idle';
        break;
      default:
        yield* Effect.succeed('unknown-state-transitioning-to-done');
        state = 'done';
    }
    iterations++;
  }

  return yield* Effect.succeed(`final-state:${state}`);
});

// ============================================================================
// 19. MIXED TERNARY + SHORT-CIRCUIT in same expression
// ============================================================================
export const mixedExpressionBranching = Effect.gen(function* () {
  const user = yield* Effect.succeed({ name: 'Bob' as string | null, active: true });

  // Ternary inside short-circuit
  const display = user.active
    ? (user.name ?? (yield* Effect.succeed('Anonymous')))
    : (yield* Effect.succeed('Inactive'));

  return display;
});

// ============================================================================
// 20. RACE PATTERN with effect branching
// ============================================================================
export const racePattern = Effect.gen(function* () {
  const result = yield* Effect.race(
    Effect.succeed('fast-path'),
    Effect.succeed('slow-path'),
  );
  return result;
});

// ============================================================================
// 21. FOR-OF with BREAK inside if (early exit detection)
// ============================================================================
export const forOfEarlyExit = Effect.gen(function* () {
  const items = yield* Effect.succeed([1, 2, 3, 4, 5]);
  for (const item of items) {
    if (item === 3) {
      yield* Effect.succeed('found-target');
      break;
    }
    yield* Effect.succeed(`scanning:${item}`);
  }
  yield* Effect.succeed('search-complete');
});

// ============================================================================
// 22. WHILE LOOP with CONTINUE inside if
// ============================================================================
export const whileWithContinue = Effect.gen(function* () {
  let i = 0;
  while (i < 5) {
    i++;
    if (i % 2 === 0) {
      continue; // skip even numbers
    }
    yield* Effect.succeed(`odd:${i}`);
  }
});

// ============================================================================
// 23. CONDITIONAL + PARALLEL: fan-out based on type
// ============================================================================
export const conditionalParallel = Effect.gen(function* () {
  const request = yield* Effect.succeed({ type: 'batch' as 'single' | 'batch', ids: [1, 2, 3] });

  if (request.type === 'batch') {
    // Parallel processing for batch
    const results = yield* Effect.all(
      request.ids.map((id) => Effect.succeed(`result:${id}`)),
    );
    return results;
  } else {
    // Single processing
    const result = yield* Effect.succeed(`single:${request.ids[0]}`);
    return [result];
  }
});

// ============================================================================
// 24. TRIPLE-NESTED TRY/CATCH (error escalation)
// ============================================================================
export const tripleNestedTry = Effect.gen(function* () {
  try {
    try {
      try {
        yield* Effect.succeed('innermost');
      } catch (e1) {
        yield* Effect.succeed('catch-l3');
        throw e1;
      }
    } catch (e2) {
      yield* Effect.succeed('catch-l2');
      throw e2;
    } finally {
      yield* Effect.succeed('finally-l2');
    }
  } catch (e3) {
    yield* Effect.succeed('catch-l1');
  } finally {
    yield* Effect.succeed('finally-l1');
  }
});

// ============================================================================
// 25. FOR LOOP WITH YIELD IN HEADER (initializer + incrementor)
// ============================================================================
export const forLoopHeaderYields = Effect.gen(function* () {
  const max = yield* Effect.succeed(5);
  for (let i = 0; i < max; i++) {
    yield* Effect.succeed(`iter:${i}`);
  }
});

// ============================================================================
// 26. COMPLEX RETURN EXPRESSIONS (yield inside returned expressions)
// ============================================================================
export const complexReturns = Effect.gen(function* () {
  const mode = yield* Effect.succeed('complex' as string);
  if (mode === 'simple') {
    return yield* Effect.succeed('simple-result');
  }
  // Return with ternary containing yields
  const x = yield* Effect.succeed(true);
  return x
    ? (yield* Effect.succeed('true-branch-return'))
    : (yield* Effect.succeed('false-branch-return'));
});

// ============================================================================
// 27. DO-WHILE WITH TRY/CATCH (retry-like pattern without Effect.retry)
// ============================================================================
export const doWhileRetry = Effect.gen(function* () {
  let attempts = 0;
  let success = false;
  do {
    try {
      yield* Effect.succeed(`attempt:${attempts}`);
      success = true;
    } catch (retryErr) {
      yield* Effect.succeed(`retry-error:${attempts}`);
      attempts++;
    }
  } while (!success && attempts < 3);
  return yield* Effect.succeed(success ? 'success' : 'exhausted');
});

// ============================================================================
// 28. SWITCH WITH BLOCKS and complex per-case logic
// ============================================================================
export const switchWithBlocks = Effect.gen(function* () {
  const action = yield* Effect.succeed('update' as string);
  switch (action) {
    case 'create': {
      const id = yield* Effect.succeed('new-id');
      yield* Effect.succeed(`created:${id}`);
      break;
    }
    case 'update': {
      const existing = yield* Effect.succeed({ id: '123', version: 1 });
      if (existing.version > 0) {
        yield* Effect.succeed(`updated:${existing.id}`);
      } else {
        yield* Effect.succeed('version-conflict');
      }
      break;
    }
    case 'delete': {
      try {
        yield* Effect.succeed('deleting');
      } catch (delErr) {
        yield* Effect.succeed('delete-failed');
      }
      break;
    }
    default:
      yield* Effect.succeed('unknown-action');
  }
});

// ============================================================================
// 29. IF inside FOR inside SWITCH inside TRY (max nesting depth)
// ============================================================================
export const maxNestingDepth = Effect.gen(function* () {
  try {
    const mode = yield* Effect.succeed('batch' as string);
    switch (mode) {
      case 'batch': {
        const items = yield* Effect.succeed([1, 2, 3]);
        for (const item of items) {
          if (item % 2 === 0) {
            yield* Effect.succeed(`even:${item}`);
          } else {
            yield* Effect.succeed(`odd:${item}`);
          }
        }
        break;
      }
      default:
        yield* Effect.succeed('single-mode');
    }
  } catch (err) {
    yield* Effect.succeed('error-in-pipeline');
  } finally {
    yield* Effect.succeed('pipeline-done');
  }
});

// ============================================================================
// 30. EMPTY BRANCHES (if with only sync code in one branch)
// ============================================================================
export const emptyBranches = Effect.gen(function* () {
  const flag = yield* Effect.succeed(true);
  if (flag) {
    yield* Effect.succeed('has-yield');
  } else {
    // No yield here — pure sync code
    console.log('sync only');
  }
  // if with yield only in else
  if (!flag) {
    console.log('sync');
  } else {
    yield* Effect.succeed('else-yield');
  }
});
