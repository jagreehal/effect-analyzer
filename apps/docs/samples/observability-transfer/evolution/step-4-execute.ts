// Step 4: Validate + fetch rate + convert + execute the transfer
import { Effect } from "effect"
import type {
  ConvertedAmount, Currency, ExchangeRate, InsufficientFundsError,
  ProviderUnavailableError, RateUnavailableError, TransferInput,
  TransferRejectedError, ValidatedTransfer, ValidationError,
} from "../types"

export type SendMoneyDeps = {
  validateTransfer: (input: TransferInput) => Effect.Effect<ValidatedTransfer, ValidationError>
  fetchRate: (args: { from: Currency; to: Currency }) => Effect.Effect<ExchangeRate, RateUnavailableError>
  getBalance: () => Effect.Effect<number, never>
  convertCurrency: (args: {
    amount: number; rate: number; fromCurrency: Currency; toCurrency: Currency; balance: number
  }) => Effect.Effect<ConvertedAmount, InsufficientFundsError>
  executeTransfer: (args: {
    recipientIban: string; amount: number; currency: Currency
  }) => Effect.Effect<{ transferId: string }, TransferRejectedError | ProviderUnavailableError>
}

export const createSendMoneyWorkflow = (deps: SendMoneyDeps) => (input: TransferInput) =>
  Effect.gen(function*() {
    const validated = yield* deps.validateTransfer(input).pipe(Effect.withSpan("validate"))
    const rate = yield* deps.fetchRate({ from: validated.fromCurrency, to: validated.toCurrency }).pipe(Effect.withSpan("fetchRate"))
    const balance = yield* deps.getBalance().pipe(Effect.withSpan("getBalance"))
    const converted = yield* deps.convertCurrency({
      amount: validated.amount, rate: rate.rate,
      fromCurrency: validated.fromCurrency, toCurrency: validated.toCurrency, balance,
    }).pipe(Effect.withSpan("convert"))
    const transfer = yield* deps.executeTransfer({
      recipientIban: validated.recipientIban,
      amount: converted.convertedAmount, currency: validated.toCurrency,
    }).pipe(Effect.withSpan("executeTransfer"))
    return { transferId: transfer.transferId, convertedAmount: converted.convertedAmount, rate: rate.rate }
  }).pipe(Effect.withSpan("sendMoney"))
