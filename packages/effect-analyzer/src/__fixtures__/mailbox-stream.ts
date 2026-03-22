import { Effect, Mailbox } from "effect"

export const mailboxProgram = Effect.gen(function* () {
  const mailbox = yield* Mailbox.make<string>()
  yield* Mailbox.offer(mailbox, "hello")
  const msg = yield* Mailbox.take(mailbox)
  const all = yield* Mailbox.takeAll(mailbox)
  const stream = Mailbox.toStream(mailbox)
  yield* Mailbox.end(mailbox)
})
