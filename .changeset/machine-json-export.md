---
"effect-analyzer": minor
---

Add `--format machine-json`, which writes XState v6 `MachineJSON` for `machineFromJSON`, with `toMachineJSON` and `renderMachineJSON` for programmatic use. `statechart-html` shows the v6 JSON beside the v5 config. Both exports keep targetless transitions and compound `onDone`, and `fromMachineJSON` reads `#rootId.path` targets and both forms of compound `onDone`. Update `@effect/tsgo` to 0.67.5 and enable `match-to-result-or-option`.
