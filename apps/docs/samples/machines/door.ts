import { Machine } from '@typeonce/effect-machine'
import { Schema } from 'effect'

const DoorStates = Machine.states({ Closed: {}, Open: {} })
const DoorEvents = Machine.events(Schema.TaggedUnion({ Toggle: {} }))

export const DoorMachine = Machine.make({
  states: DoorStates.states,
  events: DoorEvents,
  initial: (to) => to.Closed(),
}).handle({
  Closed: { on: { Toggle: (to) => to.full.Open() } },
  Open: { on: { Toggle: (to) => to.full.Closed() } },
})
