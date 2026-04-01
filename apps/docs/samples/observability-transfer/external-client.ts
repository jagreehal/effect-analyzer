import { trace } from "autotel"
import { Effect } from "effect"
import {
  ConfirmationFailedError,
  ProviderUnavailableError,
  type RateMatrix,
  RateUnavailableError,
  TransferRejectedError
} from "./types"

function getBaseUrl(): string {
  return process.env.RATES_API_BASE_URL ?? "http://localhost:3000/api"
}

export const fetchRatesFromApi = trace(
  "fetchRates",
  (_ctx) => (): Effect.Effect<RateMatrix, RateUnavailableError> =>
    Effect.tryPromise({
      try: async () => {
        const res = await fetch(`${getBaseUrl()}/rates`)
        if (!res.ok) throw new RateUnavailableError({ reason: `Rates API returned ${res.status}` })
        return (await res.json()) as RateMatrix
      },
      catch: (cause) =>
        cause instanceof RateUnavailableError
          ? cause
          : new RateUnavailableError({ reason: "Rates API unreachable" })
    })
)

export const postTransferToProvider = trace("executeTransfer", (_ctx) =>
(args: {
  recipientIban: string
  amount: number
  currency: string
}): Effect.Effect<{ transferId: string }, TransferRejectedError | ProviderUnavailableError> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(`${getBaseUrl()}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args)
      })
      if (res.status >= 400 && res.status < 500) {
        throw new TransferRejectedError({ reason: `Provider rejected: ${res.status}` })
      }
      if (!res.ok) {
        throw new ProviderUnavailableError({ reason: `Provider error: ${res.status}` })
      }
      return (await res.json()) as { transferId: string }
    },
    catch: (cause) =>
      cause instanceof TransferRejectedError || cause instanceof ProviderUnavailableError
        ? cause
        : new ProviderUnavailableError({ reason: "Provider unreachable" })
  }))

export const sendNotification = trace("sendConfirmation", (_ctx) =>
(_args: {
  transferId: string
  amount: number
  currency: string
}): Effect.Effect<void, ConfirmationFailedError> => Effect.void)
