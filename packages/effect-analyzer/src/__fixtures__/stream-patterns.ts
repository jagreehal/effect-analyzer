/**
 * Effect Stream patterns for testing static analysis
 * 
 * This fixture tests:
 * - Stream creation and composition
 * - Pipeline operations (map, filter, etc.)
 * - Sink operations
 * - Stream error handling
 */

import { Stream, Effect, Sink, Schedule } from 'effect';

// =============================================================================
// Basic Stream Programs
// =============================================================================

/**
 * Simple stream from array
 */
export const simpleStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]);
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with map transformation
 */
export const mappedStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.map((n) => n * 2)
  );
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with filter
 */
export const filteredStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).pipe(
    Stream.filter((n) => n % 2 === 0)
  );
  const result = yield* Stream.runCollect(stream);
  return result;
});

// =============================================================================
// Stream Pipelines
// =============================================================================

/**
 * Complex stream pipeline
 */
export const pipelineStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    .pipe(
      Stream.map((n) => n * n),
      Stream.filter((n) => n > 10),
      Stream.take(3),
      Stream.map((n) => `Value: ${n}`)
    );
  
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with scan (accumulation)
 */
export const scannedStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.scan(0, (acc, n) => acc + n)
  );
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with flatMap
 */
export const flatMappedStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3]).pipe(
    Stream.flatMap((n) => Stream.fromIterable([n, n * 2, n * 3]))
  );
  const result = yield* Stream.runCollect(stream);
  return result;
});

// =============================================================================
// Stream Error Handling
// =============================================================================

/**
 * Stream with error handling
 */
export const errorHandledStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.mapEffect((n) =>
      n === 3
        ? Effect.fail(new Error('Three is not allowed'))
        : Effect.succeed(n * 2)
    ),
    Stream.catchAll(() => Stream.fromIterable([0]))
  );
  
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with timeout
 */
export const timeoutStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3]).pipe(
    Stream.mapEffect((n) => Effect.sleep('100 millis').pipe(Effect.as(n))),
    Stream.timeout('500 millis')
  );
  
  const result = yield* Stream.runCollect(stream);
  return result;
});

// =============================================================================
// Stream Sinks
// =============================================================================

/**
 * Stream with custom sink
 */
export const sinkStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]);
  const sum = yield* Stream.run(stream, Sink.sum);
  return sum;
});

/**
 * Stream with fold sink
 */
export const foldSinkStreamProgram = Effect.gen(function* () {
  const stream = Stream.fromIterable(['a', 'b', 'c', 'd']);
  const result = yield* Stream.run(
    stream,
    Sink.foldLeft('', (acc, s) => acc + s)
  );
  return result;
});

// =============================================================================
// Stream Combinations
// =============================================================================

/**
 * Merged streams
 */
export const mergedStreamProgram = Effect.gen(function* () {
  const stream1 = Stream.fromIterable([1, 2, 3]);
  const stream2 = Stream.fromIterable([4, 5, 6]);
  
  const merged = Stream.merge(stream1, stream2);
  const result = yield* Stream.runCollect(merged);
  return result;
});

/**
 * Zipped streams
 */
export const zippedStreamProgram = Effect.gen(function* () {
  const stream1 = Stream.fromIterable([1, 2, 3]);
  const stream2 = Stream.fromIterable(['a', 'b', 'c']);
  
  const zipped = Stream.zip(stream1, stream2);
  const result = yield* Stream.runCollect(zipped);
  return result;
});

// =============================================================================
// Effect to Stream Conversion
// =============================================================================

/**
 * Effect.repeat as stream
 */
export const repeatingEffectStreamProgram = Effect.gen(function* () {
  const effect = Effect.succeed(Math.random());
  const stream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.mapEffect(() => effect)
  );
  const result = yield* Stream.runCollect(stream);
  return result;
});

/**
 * Stream with grouped/sliding (windowing detail: size/stride)
 */
export const windowingStreamProgram = Effect.gen(function* () {
  const grouped = Stream.fromIterable([1, 2, 3, 4, 5, 6]).pipe(
    Stream.grouped(2)
  );
  const sliding = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
    Stream.sliding(3, 2)
  );
  const a = yield* Stream.runCollect(grouped);
  const b = yield* Stream.runCollect(sliding);
  return { a, b };
});

export const main = simpleStreamProgram;
