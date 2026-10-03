/**
 * Fixture: retry and timeout options objects, a schedule const, and
 * forEach concurrency passed as a shorthand property.
 */
import { Data, Duration, Effect, Schedule } from 'effect';

class SoftFail extends Data.TaggedError('SoftFail')<{ readonly status: number }> {}

const retrySchedule = Schedule.exponential(Duration.millis(10)).pipe(
  Schedule.jittered,
  Schedule.upTo({ duration: Duration.seconds(3), times: 2 }),
);

const callOnce = (timeoutMs: number) =>
  Effect.fail(new SoftFail({ status: 503 })).pipe(
    Effect.timeoutOrElse({
      duration: Duration.millis(timeoutMs),
      orElse: () => Effect.fail(new SoftFail({ status: 504 })),
    }),
  );

export const charge = callOnce(50).pipe(
  Effect.retry({
    schedule: retrySchedule,
    while: (error) => error._tag === 'SoftFail',
  }),
);

export const chargeTimes = callOnce(50).pipe(Effect.retry({ times: 3 }));

export const chargeGen = Effect.gen(function* () {
  return yield* callOnce(50);
}).pipe(Effect.retry({ schedule: retrySchedule }));

export const enrichAll = (ids: ReadonlyArray<string>, concurrency = 3) =>
  Effect.forEach(ids, (id) => Effect.succeed(id), { concurrency, discard: false });

const schedule = Schedule.exponential('10 millis');

export const chargeShorthand = callOnce(50).pipe(Effect.retry({ schedule, times: 3 }));
