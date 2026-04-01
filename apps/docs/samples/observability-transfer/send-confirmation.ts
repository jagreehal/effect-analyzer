import { Effect } from "effect"
import { ConfirmationFailedError } from "./types"

type SendConfirmationDeps = {
  notify: (args: {
    transferId: string
    amount: number
    currency: string
  }) => Effect.Effect<void, ConfirmationFailedError>
}

export const sendConfirmation = (
  args: { transferId: string; amount: number; currency: string },
  deps: SendConfirmationDeps
): Effect.Effect<void, ConfirmationFailedError> => deps.notify(args)
