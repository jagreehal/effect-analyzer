// Step 1: Just validate the input
import { Effect } from "effect"
import type { TransferInput, ValidatedTransfer, ValidationError } from "../types"

export type SendMoneyDeps = {
  validateTransfer: (input: TransferInput) => Effect.Effect<ValidatedTransfer, ValidationError>
}

export const createSendMoneyWorkflow = (deps: SendMoneyDeps) => (input: TransferInput) =>
  Effect.gen(function*() {
    const validated = yield* deps.validateTransfer(input).pipe(Effect.withSpan("validate"))
    return { recipientIban: validated.recipientIban }
  }).pipe(Effect.withSpan("sendMoney"))
