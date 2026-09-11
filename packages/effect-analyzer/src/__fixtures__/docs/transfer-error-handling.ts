import { Effect } from 'effect';

/**
 * Docs fixture: one program covering every disposition the error diagram
 * distinguishes — caught, mapped, turned into a defect, swallowed, and left
 * in the channel for the caller.
 */

export class RateUnavailableError {
  readonly _tag = 'RateUnavailableError';
}
export class AuditFailedError {
  readonly _tag = 'AuditFailedError';
}
export class LedgerError {
  readonly _tag = 'LedgerError';
}
export class ConfigError {
  readonly _tag = 'ConfigError';
}
export class TransferRejectedError {
  readonly _tag = 'TransferRejectedError';
}

declare const fetchRate: () => Effect.Effect<number, RateUnavailableError>;
declare const recordAudit: () => Effect.Effect<void, AuditFailedError>;
declare const writeLedger: () => Effect.Effect<void, LedgerError>;
declare const loadConfig: () => Effect.Effect<string, ConfigError>;
declare const submit: () => Effect.Effect<string, TransferRejectedError>;

export const transferWithHandling = Effect.gen(function* () {
  // Caught: a fallback rate keeps the transfer moving.
  const rate = yield* fetchRate().pipe(
    Effect.catchTag('RateUnavailableError', () => Effect.succeed(1)),
  );

  // Swallowed: the audit write becomes a success no matter what happened.
  yield* recordAudit().pipe(Effect.ignore);

  // Defect: `E` now reads `never`, but the fiber still dies on a ledger fault.
  yield* writeLedger().pipe(Effect.orDie);

  // Transformed: still in `E`, under a different type.
  const config = yield* loadConfig().pipe(
    Effect.mapError(() => new TransferRejectedError()),
  );

  // Left in the channel: the caller receives this one, typed.
  const id = yield* submit();

  return { id, rate, config };
});
