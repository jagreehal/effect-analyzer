import { Effect } from "effect"
import { ProviderUnavailableError, TransferRejectedError } from "./types"

type ExecuteTransferDeps = {
  postTransfer: (args: {
    recipientIban: string
    amount: number
    currency: string
  }) => Effect.Effect<{ transferId: string }, TransferRejectedError | ProviderUnavailableError>
}

export const executeTransfer = (
  args: { recipientIban: string; amount: number; currency: string },
  deps: ExecuteTransferDeps
): Effect.Effect<{ transferId: string }, TransferRejectedError | ProviderUnavailableError> => deps.postTransfer(args)
