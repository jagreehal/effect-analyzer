/**
 * Fixture: tagged errors remapped by handlers, bounded loops, and a merged
 * Stream pipeline as `main`.
 */
import { Data, Duration, Effect, Stream } from 'effect';

class PageSkipped extends Data.TaggedError('PageSkipped')<{ readonly id: string }> {}
class PageUnavailable extends Data.TaggedError('PageUnavailable')<{ readonly id: string }> {}
class LoadFailed extends Data.TaggedError('LoadFailed')<{ readonly id: string }> {}

const CONCURRENCY = 4;

export const fetchPage = (id: string) =>
  Effect.gen(function* () {
    if (id === '') return yield* new PageSkipped({ id });
    if (id === 'x') return yield* new PageUnavailable({ id });
    return 'page:' + id;
  });

export const load = (id: string) =>
  fetchPage(id).pipe(
    Effect.catchTags({
      PageSkipped: (e) => Effect.fail(new LoadFailed({ id: e.id })),
      PageUnavailable: (e) => Effect.fail(new LoadFailed({ id: e.id })),
    }),
  );

export const resync = (ids: ReadonlyArray<string>) =>
  Effect.forEach(ids, (id) => load(id), { concurrency: CONCURRENCY }).pipe(
    Effect.catch(() => Effect.succeed([])),
  );

export const resyncGen = Effect.gen(function* () {
  yield* Effect.fail(new Error('boom'));
}).pipe(Effect.catch(() => Effect.void));

export const main = Stream.merge(
  Stream.make('a', 'b').pipe(Stream.debounce(Duration.millis(200))),
  Stream.tick(Duration.seconds(5)).pipe(Stream.map(() => 'tick')),
).pipe(
  Stream.mapEffect((id) => load(id)),
  Stream.runDrain,
);

// Data-first catchTags with method-syntax and arrow handlers.
export const loadOrDefault = (id: string) =>
  Effect.catchTags(fetchPage(id), {
    PageSkipped() {
      return Effect.succeed('skipped');
    },
    PageUnavailable: () => Effect.log('unavailable').pipe(Effect.as('fallback')),
  });

declare const cpuCount: number
const MODE = "unbounded"

export const scaledLoop = (ids: ReadonlyArray<string>) =>
  Effect.forEach(ids, (id) => load(id), { concurrency: 2 * cpuCount });

export const unboundedLoop = (ids: ReadonlyArray<string>) =>
  Effect.forEach(ids, (id) => load(id), { concurrency: MODE });

export const oneAtATime = (ids: ReadonlyArray<string>) =>
  Effect.forEach(ids, (id) => load(id), { concurrency: 1 });

export const arrayLoop = Effect.forEach([1, 2], (n) => Effect.succeed(n), { concurrency: 4 });

export const bothPages = Effect.all([fetchPage('a'), fetchPage('b')], { concurrency: 2 });

export const skippedOnly = Effect.catchTag(fetchPage('a'), 'PageSkipped', () => Effect.succeed('skipped'));

export const mergeWithOptions = Stream.make(1).pipe(
  Stream.merge(Stream.make(2), { haltStrategy: 'left' }),
  Stream.runDrain,
);

export const indexed = Stream.zipWithIndex(Stream.make('a'));

