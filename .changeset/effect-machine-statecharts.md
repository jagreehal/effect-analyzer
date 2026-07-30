---
'effect-analyzer': minor
---

State machine analysis now targets `@typeonce/effect-machine` — the schema-first
`Machine` API proposed in [Effect PR #6429](https://github.com/Effect-TS/effect/pull/6429).

`analyzeStateMachines()` reads `Machine.make({...}).handle({...})`, recognized by
resolving the `Machine` binding back to a real import of the package (named,
aliased, or namespace), so an unrelated object with a `make` method is never
mistaken for a machine. It extracts:

- the state tree from `Machine.defineStates({...})` or an inline `states:`
  literal — nesting becomes dotted paths, `type: 'parallel'` enters every
  region, and a compound `initial` becomes an initial edge
- transitions from the handler tree (`on`, the `{ reenter, transition }` long
  form, `always`, `onDone`), with targets resolved off the `target.full`,
  `target.local` (including `local.with(...)`) and `target.branch` builders,
  wherever they appear in the handler body
- final states declared in either the state tree or the handler tree
- `entry` / `exit` action labels, and `invoke` children labelled with their
  declared id — `Machine.invoke({ id })`, `Machine.child('id', M)`, or a local
  factory returning either
- the declared alphabet from the state tree plus the `events:` array
  (`alphabetSource: 'config'`), so the coverage gate works without type
  resolution. An events list that cannot be fully resolved to identifiers
  (a spread, say) reports no alphabet rather than a partial one
- branch conditions (`if` / ternary) as guard labels on the edges

Because the machine declares every final state, final-state inference is off for
these machines: a leaf with no outgoing handler renders as an ordinary state
instead of being guessed terminal. The coverage report's info line for such
states is now labelled `Dead-end states` rather than `Final states`.

Two smaller fixes ride along: `renderXStateConfig` sanitizes the generated
binding name, so a machine whose id is not a valid identifier (`'checkout-flow'`)
no longer emits unparseable TypeScript; and the diagnostics pass explains a
`Machine` binding it cannot resolve — typically a local barrel that re-exports
the package — instead of reporting nothing at all.

**Breaking:** the previous home-grown conventions — declarative transition
tables, `Match.when` tuple transition functions, and nested `Match.tags`
dispatch — are no longer detected, and the `@initial` annotation and
`initial`/`initialState` sibling-declaration heuristics are gone.
`StateMachine.source` is now `'effect-machine' | 'machine-json'`. MachineJSON
ingestion (`fromMachineJSON`), the coverage engine, and every renderer are
otherwise unchanged.
