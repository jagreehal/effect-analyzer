import { Effect } from "effect"
import { type Currency, type ExchangeRate, type RateMatrix, RateUnavailableError } from "./types"

export type FetchRateDeps = {
  getRates: () => Effect.Effect<RateMatrix, RateUnavailableError>
}

export const fetchRate = (
  args: { from: Currency; to: Currency },
  deps: FetchRateDeps
): Effect.Effect<ExchangeRate, RateUnavailableError> =>
  Effect.gen(function*() {
    const rates = yield* deps.getRates()
    const rate = rates[args.from]?.[args.to]
    if (rate === undefined) {
      return yield* Effect.fail(new RateUnavailableError({ reason: `No rate found for ${args.from} → ${args.to}` }))
    }
    return { from: args.from, to: args.to, rate }
  })
