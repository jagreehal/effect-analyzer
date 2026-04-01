import { Data, Schema } from "effect"

export const CurrencySchema = Schema.Literal("GBP", "EUR", "USD")
export type Currency = Schema.Schema.Type<typeof CurrencySchema>

export const TransferInputSchema = Schema.Struct({
  recipientIban: Schema.String.pipe(Schema.minLength(15), Schema.maxLength(34)),
  amount: Schema.Number.pipe(Schema.positive()),
  fromCurrency: CurrencySchema,
  toCurrency: CurrencySchema
}).pipe(
  Schema.filter((data) => data.fromCurrency !== data.toCurrency, {
    message: () => "From and to currencies must be different"
  })
)

export type TransferInput = Schema.Schema.Type<typeof TransferInputSchema>
export type ValidatedTransfer = TransferInput & { readonly _validated: true }
export type RateMatrix = Record<Currency, Partial<Record<Currency, number>>>

export type ExchangeRate = { from: Currency; to: Currency; rate: number }

export type ConvertedAmount = {
  originalAmount: number
  convertedAmount: number
  rate: number
  fromCurrency: Currency
  toCurrency: Currency
}

export class ValidationError extends Data.TaggedError("ValidationError")<{ reason?: string; cause?: unknown }> {}
export class RateUnavailableError
  extends Data.TaggedError("RateUnavailableError")<{ reason?: string; cause?: unknown }>
{}
export class InsufficientFundsError
  extends Data.TaggedError("InsufficientFundsError")<{ required: number; available: number }>
{}
export class TransferRejectedError
  extends Data.TaggedError("TransferRejectedError")<{ reason?: string; cause?: unknown }>
{}
export class ProviderUnavailableError
  extends Data.TaggedError("ProviderUnavailableError")<{ reason?: string; cause?: unknown }>
{}
export class ConfirmationFailedError
  extends Data.TaggedError("ConfirmationFailedError")<{ reason?: string; cause?: unknown }>
{}
