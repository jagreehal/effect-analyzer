import { Effect } from "effect"
import { type ConvertedAmount, type Currency, InsufficientFundsError } from "./types"

export const convertCurrency = (args: {
  amount: number
  rate: number
  fromCurrency: Currency
  toCurrency: Currency
  balance: number
}): Effect.Effect<ConvertedAmount, InsufficientFundsError> =>
  Effect.gen(function*() {
    if (args.balance < args.amount) {
      return yield* Effect.fail(new InsufficientFundsError({ required: args.amount, available: args.balance }))
    }
    const convertedAmount = Math.round(args.amount * args.rate * 100) / 100
    return {
      originalAmount: args.amount,
      convertedAmount,
      rate: args.rate,
      fromCurrency: args.fromCurrency,
      toCurrency: args.toCurrency
    }
  })
