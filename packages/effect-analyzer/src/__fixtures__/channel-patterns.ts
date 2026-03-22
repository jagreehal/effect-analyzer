import { Stream, Channel } from "effect"

export const channelProgram = Stream.make(1, 2, 3).pipe(
  Stream.pipeThroughChannel(Channel.identity<number>())
)
