---
'effect-analyzer': minor
---

Recognize the `@typeonce/effect-machine` 0.6+ API alongside the 0.5 one.

`Machine.states({...})` is read as a state tree, `Machine.events(...)` as the
declared alphabet, and target builders are resolved off the handler's own
parameter (`(to) => to.full.X()`) as well as the destructured `target`. Also new:
`to.branches({ name: { target } })` contributes the branch name as the guard
label, an invoke builder's `.onDone` / `.onFailure` become `done` / `error`
completion transitions, schema-less state nodes (`Idle: {}`, `{ type: 'final' }`)
are read, and a definition stored in a `const` and implemented by more than one
`.handle({...})` yields one machine per implementation.

Fixes the statechart summary line, which counted automatic triggers (`initial`,
`always`, an invoke's `onDone` / `onError`) as declared events.
