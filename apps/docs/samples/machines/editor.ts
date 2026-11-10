import { Machine } from '@typeonce/effect-machine'
import { Schema } from 'effect'

const EditorStates = Machine.states({
  workspace: {
    type: 'parallel',
    states: {
      document: { initial: 'Clean', states: { Clean: {}, Dirty: {} } },
      connection: { initial: 'Online', states: { Online: {}, Offline: {} } },
    },
  },
})
const EditorEvents = Machine.events(
  Schema.TaggedUnion({ Edit: {}, Save: {}, Disconnect: {}, Reconnect: {} }),
)

export const EditorMachine = Machine.make({
  states: EditorStates.states,
  events: EditorEvents,
  initial: (to) => to.workspace(),
}).handle({
  workspace: {
    states: {
      document: {
        states: {
          Clean: { on: { Edit: (to) => to.local.Dirty() } },
          Dirty: { on: { Save: (to) => to.local.Clean() } },
        },
      },
      connection: {
        states: {
          Online: { on: { Disconnect: (to) => to.local.Offline() } },
          Offline: { on: { Reconnect: (to) => to.local.Online() } },
        },
      },
    },
  },
})
