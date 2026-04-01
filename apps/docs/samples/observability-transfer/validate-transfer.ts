import { Effect, Schema } from "effect"
import { TransferInputSchema, type ValidatedTransfer, ValidationError } from "./types"

export const validateTransfer = (input: unknown): Effect.Effect<ValidatedTransfer, ValidationError> =>
  Schema.decodeUnknown(TransferInputSchema)(input).pipe(
    Effect.flatMap((data) => {
      if (data.recipientIban.toUpperCase().includes("B00M")) {
        return Effect.annotateCurrentSpan({
          "transfer.recipient_iban": data.recipientIban,
          "validation.status": "failed",
          "validation.error": "Invalid IBAN format"
        }).pipe(
          Effect.flatMap(() => Effect.fail(new ValidationError({ reason: "Invalid IBAN format" })))
        )
      }
      return Effect.annotateCurrentSpan({
        "transfer.recipient_iban": data.recipientIban,
        "transfer.amount": data.amount,
        "transfer.from_currency": data.fromCurrency,
        "transfer.to_currency": data.toCurrency,
        "validation.status": "passed"
      }).pipe(
        Effect.map(() => ({ ...data, _validated: true } as ValidatedTransfer))
      )
    }),
    Effect.mapError((error) =>
      error instanceof ValidationError ? error : new ValidationError({ reason: error.message, cause: error })
    )
  )
