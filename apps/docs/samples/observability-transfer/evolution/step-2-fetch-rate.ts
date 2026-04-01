// Step 2: Validate + fetch exchange rate
import { Effect } from "effect"
import type { Currency, ExchangeRate, RateUnavailableError, TransferInput, ValidatedTransfer, ValidationError } from "../types"

export type SendMoneyDeps = {
  validateTransfer: (input: TransferInput) => Effect.Effect<ValidatedTransfer, ValidationError>
  fetchRate: (args: { from: Currency; to: Currency }) => Effect.Effect<ExchangeRate, RateUnavailableError>
}

export const createSendMoneyWorkflow = (deps: SendMoneyDeps) => (input: TransferInput) =>
  Effect.gen(function*() {
    const validated = yield* deps.validateTransfer(input).pipe(Effect.withSpan("validate"))
    const rate = yield* deps.fetchRate({ from: validated.fromCurrency, to: validated.toCurrency }).pipe(Effect.withSpan("fetchRate"))
    return { recipientIban: validated.recipientIban, rate: rate.rate }
  }).pipe(Effect.withSpan("sendMoney"))
