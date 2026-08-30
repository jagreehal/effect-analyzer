# effect-analyzer

## 3.2.0

### Minor Changes

- dc5a235: Four fixes to what the analyzer could see and what the CLI would tell you.

  **Type assertions no longer blind the walker.** `Effect.succeed(1) as Effect.Effect<number>` is the same effect as `Effect.succeed(1)`, but the walker stopped at the `as` and emitted an unknown node — the same for `satisfies`, `!`, `<T>` and parens. On `effect/packages/effect/src`, `Could not determine effect type` drops from 141 nodes to 29, and unknown nodes overall from 262 to 165. `unwrapExpression` already existed in `core-analysis.ts`; it moves to `analysis-utils.ts` so the program walker can reach it without an import cycle, and `state-machine-ast.ts` now re-exports it instead of carrying a fourth copy of the rule that missed `!`.

  **`accidental-hub` coupling issue.** A file high on fan-in _and_ fan-out is a junction, not an interface: a change to anything it imports can travel to everything that imports it. That combination was previously two ordinary warnings some distance apart in the list. It is now one issue that replaces the pair, sorts below `critical-fanin`, and enters the agent report at `P1`. Bounded below `criticalFanInThreshold`, and suppressed by a known-hub annotation. Adds `accidentalHubs` to `CouplingSummary` and `'accidental-hub'` to `CouplingIssue['type']` — both public, so an exhaustive `switch` needs the new case.

  **`--help` matches the parser, and bad flag values are refused.** Seven working flags (`--diff`, `--regression`, `--include-trivial`, `--entry-points`, `--config-leaks`, `--cli-commands`, `--no-test`) and `--format migration` were undocumented; `cli-help.test.ts` now reads the parser's source and fails the build when a flag or format value is missing from the help text. `--format nosuchformat` used to leave the default in place and exit 0 — a CI typo produced the wrong artifact and passed. Unknown _and_ missing values for `--format`, `--direction`, `--detail`, `--profile`, `--test-runner` and `--improve-min-priority` are now reported and exit 1. Errors print once, without the Effect `Cause`.

  **`--watch` survives an atomic save.** `fs.watch(path)` watches an inode; an editor that saves by writing a temp file and renaming over the original unlinks it, and Node then delivers one `rename` event and nothing further, forever — no error, no exit, a watcher that looks healthy and has stopped watching. It now watches `dirname(path)` and filters on `basename(path)`.

  **Breaking:** `parseArgs` returns `{ pathArg, options, errors }` (callers destructuring the first two are unaffected), and a command that passed an unrecognised enum value and ran anyway now exits 1.

## 3.1.1

### Patch Changes

- 1c41e0b: Stop `output/html.ts` from splicing a regex across template-literal boundaries,
  which made rolldown emit an empty chunk.

  To embed a literal `${` in the generated viewer script, the source closed the
  template literal and concatenated:

  ```
  q.replace(/[.*+?^$` + `{}()|\\[\\]\\\\]/g, '\\\\$` + `&')
  ```

  Bundling that through rolldown — Vite 8's bundler — produces a **zero-byte**
  chunk for whatever entry pulls in `renderInteractiveHTML`. No error, no warning:
  the build succeeds and the output is empty. Escaping the dollar as `\${` keeps
  the template intact and bundles normally. The second splice was never needed,
  because `$&` is not `${`.

  The rendered HTML is byte-identical before and after, so this changes nothing
  about the viewer — it only makes the module survive a rolldown-based bundler.
  Anyone bundling `renderInteractiveHTML` with Vite 8 would otherwise get an entry
  that silently does nothing.

  This is what took down the docs playground, whose analysis runs in a module
  worker: an empty worker chunk still serves as `200 application/javascript`, and
  an empty module is a valid module, so it loads without firing `error`, registers
  no `message` listener, and never replies. The page waited on "Analyzing in
  worker..." indefinitely.

## 3.1.0

### Minor Changes

- 92987ac: Recognize the `@typeonce/effect-machine` 0.6+ API alongside the 0.5 one.

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

- 92987ac: Four additions drawn from the effect-machine devtools, aimed at Effect in
  general rather than any one library.

  **Isolated runtime probes** (`runtime-probe.ts`). Static analysis has to
  re-derive what Effect already knows exactly. A probe asks the real value
  instead, importing one module in a separate short-lived process so a target that
  throws, hangs, or calls `process.exit` cannot take the analyzer with it. Every
  failure comes back as a typed `RuntimeProbeError`. Importing a module runs its
  top-level code, so probing is opt-in and says so — see `SECURITY_NOTE`.

  **Exact JSON Schema** — `--format json-schema --export <Name>` returns what
  `Schema.toJsonSchemaDocument` produces, including refinements, annotations and
  transformations that no AST walker can see.

  **Last-good retention** (`analysis-retention.ts`). A file saved mid-edit does not
  parse. `--watch` used to clear the screen before every run, so each keystroke
  blanked the diagram and left a bare error. The render is now buffered
  (`captureStdout`) and the screen is cleared only once a run succeeds; a failure
  that follows a success keeps the last valid analysis on screen and marks it
  `partial`.

  **Walkthroughs** (`walkthrough.ts`). `generatePaths` enumerates every path at
  once, which explodes combinatorially and cannot be steered. A walkthrough is the
  other half: one step at a time, every branch offered as an explicit choice
  rather than guessed, an immutable timeline, and `rewind` to truncate the future
  and explore a different branch. Nodes the IR cannot see into are reported as
  `opaque` instead of invented.

  **Versioned JSON.** `--format json` now stamps `schemaVersion` so consumers can
  validate and migrate. Additive: the document shape is otherwise unchanged.

### Patch Changes

- 92987ac: Decompose `cli.ts`.

  It had reached 2838 lines: argument parsing, help text, shared plumbing, ten
  analysis modes and the dispatcher in one file, with three more modes written
  inline inside `main`. Adding anything meant reading past all of it.

  It is now dispatch only, at 274 lines:

  - `cli-options.ts` — `CLIOptions` and `parseArgs`, pure
  - `cli-help.ts` — the `--help` text
  - `cli-support.ts` — `CliError`, styling, path resolution, output helpers
  - `cli-mode-analysis.ts` / `-project` / `-api` / `-statechart` / `-reports` /
    `-extras` — one module per mode, each under 550 lines
  - `watch-mode.ts` — extracted earlier

  No behaviour change: seventeen representative CLI invocations produce
  byte-identical output before and after, apart from a timestamp in `--format
json`.

- 92987ac: Add mutation testing (Stryker), and close the gaps it found.

  `parseArgs` — the entire CLI flag surface, 654 lines — had no in-process test at
  all. Every CLI test spawns a subprocess, so the flag table itself was never
  checked: mutation testing scored it 0%, with 1245 mutants surviving. It now has
  a table-driven test covering every flag, both `--flag value` and `--flag=value`
  forms, the inclusive ends of every numeric range, and each error path's message.
  Score: 98.5%, with the remainder verified as equivalent mutants.

  Two smaller gaps: `makeRetainer().latest()` was never called by a test, and
  `captureStdout` was never given a `Uint8Array` chunk nor checked for the `true`
  that `write` must return.

  Also removes five `if (value !== undefined)` guards in `parseArgs` that could
  not change the outcome — `Number.parseInt(undefined, 10)` is already `NaN`, and
  the range check that follows rejects it.

  `stryker run` runs in place (`inPlace: true`): the sandbox copy rewrites
  `tsconfig.json` through `ts.parseConfigFileTextToJson`, which the TypeScript 7
  native preview this package builds against does not expose.

- 92987ac: Fixes from a review of the probe, watch and mutation-testing work.

  **Watch mode serializes its refreshes.** Rendering runs through `captureStdout`,
  which swaps the global `process.stdout.write`. Only the debounce stood between
  two analyses, so an analysis slower than the 300ms window overlapped the next
  one — and overlapping captures restore in the order they _finish_, leaving
  stdout pointing at a buffer nobody reads. The watcher stayed alive and went
  permanently silent. Refreshes now run one at a time, with a burst arriving
  mid-run collapsing into a single follow-up rather than a queue of redundant
  analyses.

  **Probing no longer shells out to `npx tsx`.** `tsx` was undeclared and
  unpinned, so a clean or offline install had nothing to fall back on and an
  online one would download and execute whatever `tsx@latest` was that day —
  arbitrary code chosen at run time, around a feature whose whole point is
  isolation. It is now a pinned runtime dependency, resolved from this package
  and spawned via `process.execPath`, so probing no longer depends on `PATH`
  resolving anything.

  **Probe timeouts kill the module, not just the process they spawned.** `tsx`
  re-spawns node to install its loaders, so the probed module is a grandchild.
  Killing the direct child left it running — still burning a core, still holding
  the pipes, so `close` never arrived and the timeout never surfaced. The probe
  now runs in its own process group and kills the group.

  **Walkthroughs are reachable.** `beginWalkthrough`, `advance` and `rewind` were
  described in a minor changeset but exported from no entry point. They are now
  exported from the package root.

  **Mutation testing runs in a sandbox.** `inPlace: true` rewrote the real source
  files, so an interrupted run left the tree full of instrumentation and
  `// @ts-nocheck` and took any uncommitted edits with it. It now runs in
  Stryker's sandbox, with `pnpm test:mutation-sandbox` as the regression test.

  The config is otherwise back on Stryker's defaults: always-on `incremental`,
  `timeoutMS` and `concurrency` overrides are gone, since a real run needs none of
  them (0 timeouts, and the auto-picked concurrency is higher than the 4 that was
  pinned). The one setting that remains non-obvious is `tsconfigFile`, which names
  a deliberately absent file so Stryker skips a preprocessor that calls
  `ts.parseConfigFileTextToJson` — an API TypeScript 7 no longer exposes from its
  main entry point. That is documented in the README's Mutation Testing section.

  Mutation testing of the new refresh queue found two gaps its tests had missed: a
  lone change running twice, and — worse — a `running` flag that never cleared,
  which would leave the watcher alive but permanently idle. Both are now covered.

  **`--quiet` applies to every progress line.** The program count ignored the
  flag while the line explaining that count respected it, so `--quiet` reported
  `Found 2 program(s)` above a single diagram with nothing saying that the other
  was filtered as trivial. All progress output now routes through one
  quiet-aware helper, so a new line cannot forget the flag. Watch-mode frames,
  which render with `quiet`, lose the stray count line as a result.

  **The probe could load a second `effect` and silently drop constraints.** The
  runner resolved `effect/Schema` from the working directory while the probed
  module resolved its own `effect` through tsx. When those differed — easily, in a
  pnpm workspace where `NODE_PATH` points at a hoisted store holding a different
  release — `toJsonSchemaDocument` did not recognise the refinements the other
  instance had created and left them out. The result was a schema that looked
  right and quietly lacked its bounds, which is worse than a failure, and it
  defeats the one thing runtime probing exists to do. The runner now resolves
  `effect` from the probed module itself, so it is always the same instance the
  module imported, whatever the cwd or `NODE_PATH`.

  **The full mutation run works now, which it never did.** Sandboxing exposed two
  suite problems that `inPlace: true` had hidden by running tests in the real
  tree. `tsgo-diagnostics` proved cwd-independent resolution with
  `process.chdir()`, which throws under the worker-based runner Stryker uses; it
  now runs that check in a child process rooted elsewhere, which is what the test
  meant and drops a global mutation from the suite. And the analyzer's
  fixture sweep asserted that every `__fixtures__` file yields Effect programs,
  which the deliberately non-Effect `probe-*` fixtures do not — they are excluded
  the same way `regression-*` already was.

  Note that `tsx` is now a runtime dependency of the package, not a devDependency,
  because runtime probing needs it at run time in a consumer's install.

  **A clean install on main was failing, and the exclusion list was why.** A
  dependabot bump moved `oxlint` to 1.79.0 while `@effect/tsgo` stayed on 0.36.5,
  which supports only 1.77.0/1.78.0, so `prepare` died with
  `UnsupportedTargetPackageVersionError`. The `tsgo-toolchain` dependabot group
  exists to keep those in lockstep, but grouping cannot bump a package that a
  policy is holding back: `@effect/tsgo` was in `minimumReleaseAgeExclude` while
  the platform artifacts it depends on — `@effect/tsgo-<platform>` — were not, so
  the wrapper was exempt and the binary it needs was still age-gated. The
  artifacts (and `@oxlint/*`) are excluded now, and `@effect/tsgo` moves to 0.37.0
  alongside oxlint 1.79.0.

- 92987ac: Fix the railway diagram collapsing to `Empty((No steps))` for generator programs.

  `renderRailwayMermaid` recursed into a generator through `getStaticChildren`,
  which maps yields to their effect nodes and drops each yield's variable name. A
  `const x = yield* deps.call(...).pipe(...)` therefore reached the step filter as
  an unnamed node inside a pipe wrapper, was judged "anonymous plumbing", and was
  skipped — taking every step of the workflow with it.

  The generator's yields are now walked directly so the binding survives, steps are
  labelled `x <- deps.call`, and anything a generator awaited counts as a step
  whether or not it was bound.

- 92987ac: Structural cleanups from a maintainability review of the state-machine, railway
  and probe work.

  - `schema-to-json-schema.ts`: the converter dispatched through a predicate that
    meant "callee is X" for calls and "the source text mentions X anywhere" for
    everything else, at nine call sites. Constructs now live in one table keyed by
    the call's own name, and the text heuristics exist in exactly one function
    used only where there is no callee to read.
  - `state-machine.ts` was pushed to 1070 lines. The generic ts-morph plumbing
    moved to `state-machine-ast.ts`, which the diagnostics scanner now shares for
    import resolution instead of keeping a second copy of it.
  - Watch mode moved out of `cli.ts` into `watch-mode.ts`, with the decision of
    what a refresh shows extracted as a pure `frameFor` and tested directly.
    `cli.ts` is now smaller than before this work began.
  - `walkthrough.ts` used `as unknown as` to read error-handler nodes that already
    have a type and a guard (`isStaticErrorHandlerNode`), and exposed its cursor
    on the public `Walkthrough` type. Both fixed.
  - `probeRuntime` returned a caller-chosen type for unvalidated JSON that crossed
    a process boundary. It returns `unknown`; `probeJsonSchema` decodes it and
    fails with a typed error when the shape is wrong.
  - The railway walker threaded a `binding` and a `yielded` boolean through every
    step. Both collapse into one `Arrival` value, and the skip predicate splits
    into `isDefinitionNode` and `isAnonymousEffect`.

- 92987ac: Remove dead plumbing from the Effect Schema → JSON Schema converter, found by
  mutation testing.

  `WalkContext` carried `sf`, `project` and a `defs` map through every construct
  in the dispatch table. Nothing ever read them, and no caller ever passed `defs`.
  Both are gone, along with `schemaToJsonSchema`'s `sf` and `project` parameters.

  `resolveSchemaNode` had two branches that cannot run: an import-specifier walk
  that `getAliasedSymbol()` already subsumes, and a same-file fallback search
  reached only when symbol resolution has already failed, in which case the search
  fails too. 56 lines become 15.

  Coverage of the module went from a 29% mutation score to 95%: every entry in the
  construct table now has a test, including the ones that were silently returning
  `undefined`.

- 92987ac: Fix `Schema.Struct` with an array field being converted to an array instead of
  an object in `api-docs` / `openapi-paths` output.

  The Effect Schema → JSON Schema walker dispatched on
  `node.getText().includes('Schema.Array')`, which matches anything nested in the
  arguments too, so `Schema.Struct({ tags: Schema.Array(Schema.String) })` was
  read as an array of arrays and lost every property. Dispatch now reads the
  construct's own callee, so a nested `Schema.Array` no longer captures its
  parent. The same bug applied to `Schema.Union` with an array member.

## 3.0.0

### Major Changes

- 3a43816: Delegate type-aware Effect linting to `@effect/tsgo` instead of reimplementing it.

  - **Breaking:** the zero-argument members of the fluent `analyze()` /
    `analyze.source()` / `analyzeSource()` results are now Effects rather than
    functions returning Effects — Effect is already lazy, so the wrapper was
    redundant indirection. `named(name)` takes an argument and is unchanged.

    ```diff
    - const programs = yield* analyze(file).all()
    + const programs = yield* analyze(file).all
    ```

    Applies to `single`, `singleOption`, `all`, `first`, `firstOption`.

  - New `--tsgo[=<tsconfig>]` flag merges the official Effect language service's ~95
    type-aware diagnostics into `--lint-source` findings. `@effect/tsgo` is a
    required dependency, while its native diagnostic runner resolves the target
    project's own TypeScript 7 installation so its compiler generation and rules
    agree with the user's editor.
  - **Breaking for linting:** five source rules that duplicated a type-aware
    `@effect/tsgo` equivalent were removed — `effect-fail-untagged`,
    `raw-side-effect-in-gen`, `run-effect-in-gen`, `console-log-in-effect`,
    `useless-pipe`. Their tsgo counterparts (`globalErrorInEffectFailure`,
    `globalFetchInEffect` / `processEnvInEffect` / `newPromise` and friends,
    `runEffectInsideEffect`, `globalConsoleInEffect`, `unnecessaryPipe`) use the
    type checker rather than AST heuristics. The `--improve` fix generators for
    those rules were removed with them. Note that most of these tsgo rules default
    to `off` — enable them in your plugin options (or `.oxlintrc.json`) or you
    will lose the coverage rather than upgrade it.
  - Toolchain: TypeScript 6 → 7. Declarations are now emitted by
    `tsc --emitDeclarationOnly` because tsup's `dts` bundling drives the
    TypeScript JS compiler API, which the native port no longer exposes. The four
    aliased subpath exports therefore resolve types from `*-entry.d.ts`.
  - Toolchain: ESLint → oxlint, because `typescript-eslint` refuses TypeScript 7
    in every published version. oxlint also hosts the `effecttsgo/*` rules.

### Patch Changes

- d28688c: Document the analyzer as a guardrail for coding agents.

  The README and the docs now lead with the check that no expression-level tool covers:
  a program's shape (what it requires, what it can fail with, how it retries) changing in
  a way that still compiles, still passes `oxlint`, and still satisfies the official
  `@effect/tsgo` diagnostics.

  - New **Guardrails for Coding Agents** page walking through `--agent-report` for the
    backlog, `--lint-source --baseline --fail-on-new` for the gate, and `--diff` for
    review, with a GitHub Actions job.
  - README gains the same three commands as a section, and the introduction names coding
    agents as consumers of the output.
  - Every command and output sample in the new docs was run against the committed
    fixtures first. `--diff` is documented as always exiting `0`, since it reports rather
    than gates.

## 2.2.0

### Minor Changes

- a8e4572: State machine analysis now targets `@typeonce/effect-machine` — the schema-first
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

## 2.1.0

### Minor Changes

- 40d7865: Sharpen coverage-audit unknown-node diagnostics.

  - The "Located unknown nodes" list now reports truncation as
    `Located unknown nodes (showing 10 of N):` instead of silently capping at 10.
  - Unresolved nodes are now classified by kind — non-Effect object literal,
    predicate/boolean expression, unrecognized constructor, unresolved
    property access or identifier, non-Effect conditional/function expression —
    so `Top unknown node reasons` is an actionable histogram rather than one
    opaque `Could not determine effect type` bucket. That default reason still
    applies to genuinely unclassifiable node kinds.

## 2.0.0

### Major Changes

- 51605bc: Deepen project audits around a reusable Project corpus, located fidelity findings,
  named assessment dimensions, native CI policy gates, and explicit human, quiet,
  and JSON report modes.

  The ambiguous `percentage` and `analyzableCoverage` fields have been removed from
  `CoverageAuditResult`. Read `assessment.effectAdoption`,
  `assessment.analysisSuccess`, and `assessment.sourceResolution` instead. Each
  dimension includes its numerator, denominator, and normalized rate.

## 1.1.0

### Minor Changes

- 930d721: Statechart modeling depth: much of XState's modeling value, no extra runtime.

  - **Named actions**: transitions take `actions: [...]`; states take `entry` /
    `exit` action labels — in transition tables and MachineJSON. Rendered on
    mermaid edges and state boxes, carried into the exported XState config.
  - **Invoke annotations**: `invoke: { src, onDone, onError }` in tables and
    MachineJSON (shape matches XState v6 `InvokeJSON`). Completions become
    automatic `done`/`error` transitions — reachability edges excluded from
    event coverage — and the exported config rebuilds the invoke block.
  - **Explicit finals**: `type: 'final'` in tables and MachineJSON. An explicit
    marker turns off no-outgoing inference, and explicitly-final states are no
    longer reported as dead-end findings.
  - **Hierarchy**: dotted state names (`'Playing.Paused'`) nest as composite
    states in mermaid and as nested `states` with absolute `#id.path` targets in
    the exported config; `@initial` accepts dotted paths.
  - **Automatic transitions in tables**: reserved `always` and `'after 500ms'`
    keys, matching the MachineJSON labels.
  - **Parallel states** carry through to the exported config as
    `type: 'parallel'` instead of collapsing to one region's initial.
  - **Match extraction**: `new StateClass()` handler returns resolve to the
    class's declared `Schema.TaggedClass` tag (class name and tag need not
    match).
  - **Public API**: `effect-analyzer/analysis` now exports the statechart
    renderers (`renderStatechartMermaid`, `renderStatechartsMermaid`,
    `renderXStateConfig`, `renderStatechartSVG`) alongside `fromMachineJSON`,
    `computeStateMachineCoverage`, and the `MachineJSON` types, so MachineJSON
    machines can be rendered programmatically.
  - **Fixed conventions**: the nested `Match.tags` style now closes its matchers
    (`Match.tagsExhaustive` + `Match.orElse`) and compiles on Effect v4;
    `Schema.TaggedRequest` (removed in Effect v4) replaced with
    `Schema.TaggedClass` throughout docs and fixtures.

## 1.0.0

### Major Changes

- 2ceccde: Support Effect v4 exclusively and deepen analysis setup, IR traversal, diagram
  fidelity, runtime span overlays, and the public package interface.

## 0.3.4

### Patch Changes

- 3d272b9: chore: update dependencies

  Minor/patch dependency refresh via npm-check-updates (--target minor, 3-day publish cooldown) — no major version bumps.

## 0.3.3

### Patch Changes

- 1eb389c: chore: update dependencies

  Minor/patch dependency refresh via npm-check-updates (--target minor, 3-day publish cooldown) — no major version bumps.

## 0.3.0

### Minor Changes

- 74a16d0: Add state machine analysis with XState-style statecharts.

  Detect plain-Effect state machines (declarative transition tables and Match.when transition functions) and render them as statecharts without an XState dependency. Renderers cover mermaid (stateDiagram-v2), a self-contained SVG, a local HTML visualizer (with `--open`), and pasteable `createMachine()` config for stately.ai/viz.

  Schema-aware coverage reads the declared alphabet from tagged unions or Schema-derived types and reports unhandled events, unreachable states, and undeclared symbols, with a `--min-coverage` threshold, `--coverage-json`, and a non-zero CI exit on warnings. When a command finds no machines, near-miss diagnostics explain why each candidate was rejected.

## 0.2.0

### Minor Changes

- 87437e0: Add module coupling analyzer and consistent JSON output across health analyzers.

  **New: `--coupling` analyzer.** Reports per-file fan-in (incoming imports) and fan-out (outgoing imports) across a project, with TypeScript AST-based parsing that handles regular imports, type-only imports, re-exports, dynamic `import()`, and side-effect imports. Surfaces three issue types: `high-fanin` (≥15 dependents), `critical-fanin` (≥30 dependents), and `high-fanout` (≥20 internal imports).

  **New: in-source hub annotations.** Mark intentional hubs (central type files, public API entry points, service registries) with either:

  ```typescript
  /** @known-hub central registry */
  ```

  or:

  ```typescript
  // effect-analyzer-known-hub central registry
  ```

  Annotated hubs are excluded from `high-fanin` issues but still tracked, so unexpected growth is flagged. The annotation lives next to the code, is grep-able, and carries a written reason.

  **New: `--format json` support on `--error-channel`, `--service-health`, `--performance`, and `--coupling`.** The JSON renderers existed in the library but weren't wired through the CLI; now they are.

  **New public exports** from `effect-analyzer`:

  - `analyzeCoupling(files, projectRoot, options?)` — accepts an optional prebuilt `ts-morph` `Project` for in-memory analysis (test- and browser-friendly)
  - `renderCouplingReport(analysis)` and `renderCouplingJson(analysis, pretty?)`
  - Types: `FileCouplingMetrics`, `CouplingIssue`, `CouplingAnalysis`, `CouplingSummary`, `AnalyzeCouplingOptions`
  - `CouplingPriorityMap` on `BuildAgentReportOptions` for overriding the default coupling issue priorities in agent reports

  **Agent report integration.** Coupling issues fold into the prioritized agent backlog alongside lint, coverage, error channel, service health, and performance findings.

## 0.1.13

### Patch Changes

- e4263fa: Add improve mode, fix generators, and new analyzers; refresh HTML output and docs.

  ## New analyzers and tooling

  - `improve-mode.ts`: produces actionable, prioritized patches for improving Effect codebases.
  - `fix-generators.ts`: deterministic fixers for common source-linter rules.
  - `performance-antipatterns.ts`: detects common Effect performance pitfalls.
  - `service-health.ts`: surfaces service/layer dependency health issues.
  - `error-channel.ts`: dedicated error-channel analysis.
  - `agent-report.ts`: structured report output tailored for AI agents.
  - CLI: new flags and entry wiring to drive the above.

  ## HTML output

  - Refreshed styling, theme variables, and typography for headers, toolbars, and buttons.
  - New `DiagnosticPanel` component renders terminal-style command examples and results.

  ## Docs

  - New pages: `project/app-shape`, `project/health`, `project/improve`, `project/source-linter`.
  - Updated CLI reference, introduction, and landing page.
  - Playground refresh and new `CompareShowcase` component.

## 0.1.12

### Patch Changes

- b11d404: Add 16 deterministic source-linter rules with docs links and Bad/Good examples.

  **New rules:**

  - `console-log-in-effect` — `console.log` inside `Effect.gen` (loses span/fiber context)
  - `promise-api-in-gen` — `Promise.all/race/resolve/...` inside `Effect.gen` (bypasses interruption)
  - `effect-fail-untagged` — `Effect.fail(new Error(...))` (use `Data.TaggedError`)
  - `run-effect-in-gen` — `Effect.runPromise/runSync/runFork` inside `Effect.gen` (nested runtime)
  - `forEach-without-concurrency` — `Effect.forEach` with no options (silent sequential default)
  - `identity-catch` — `Effect.catch(e => Effect.fail(e))` and tag variants (no-op)
  - `empty-effect-all` — `Effect.all([])` / `Effect.all({})` (always-succeeds dead branch)
  - `layer-duplicate-merge` — `Layer.merge(A, A)` (last-wins; usually a typo)
  - `schedule-unbounded` — `Schedule.forever`/`Schedule.spaced` without bounding combinator
  - `config-secret-without-redacted` — `Config.string("API_TOKEN")` etc. (use `Config.redacted`)
  - `return-effect-from-sync` — `Effect.sync(() => Effect.succeed(x))` (`Effect<Effect<...>>`)
  - `yield-promise` — `yield* fetch(...)` / `yield* Promise.all(...)` (runtime crash)
  - `useless-pipe` — `pipe(x)` with a single argument
  - `tryPromise-without-catch` — `Effect.tryPromise(fn)` short form (errors collapse to `UnknownException`)
  - `barrel-import-from-effect` — `import { Effect } from "effect"` (mirrors `@effect/eslint-plugin`)
  - `array-push-spread` — `arr.push(...xs)` (V8 stack-overflow footgun; mirrors Effect repo's own `no-restricted-syntax`)

  **Per-rule docs & examples.** Every emitted `LintIssue` now optionally carries:

  - `docsUrl` — link to the most relevant page on `effect.website`
  - `example` — `{ bad, good }` copy-pasteable snippet illustrating the fix

  URLs verified against the Effect website MDX tree. Renderers (CLI/LSP/HTML) can surface this without per-rule logic.

  **Disable pragmas.** The runner honors:

  - `// eslint-disable-next-line <rule>` and `// eslint-disable-line <rule>`
  - `// effect-analyzer-disable-next-line <rule>` and `// effect-analyzer-disable-line <rule>`
  - Bare directives (no rule name) disable all rules on that line
  - `no-restricted-syntax` is recognised as an alias for `array-push-spread`

  **Scoping & noise reduction.**

  - `.tst.ts` (dtslint type-test) files are skipped entirely — their degenerate runtime patterns are type assertions, not code.
  - `barrel-import-from-effect` matches the Effect team's own ESLint scope (`packages/*/src/**/*` only — not test files).

  **False positives caught during dogfooding on real Effect codebases.** Validated against `effect/packages`, `alchemy-effect`, `t3code`, the EffectPatterns docs, and 10 example/getting-started repos — ~5,000 files. Seven FP categories were found and fixed before release:

  | FP                                                                                   | Fix                                                     |
  | ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
  | `yield-promise` on shadowed `fetch` (local binding)                                  | resolve identifier symbol; skip if locally declared     |
  | `live-layer-in-test` matching `runLive` / `describeTimeToLive`                       | require PascalCase; exclude `*TimeToLive`               |
  | `untagged-throw` inside `Effect.try({ try, catch })`                                 | detect catch field; only flag throws with no handler    |
  | `schedule-unbounded` inside `Stream.repeat` / `Stream.fromSchedule` / `Stream.tick`  | consumer-controlled streams are intentionally unbounded |
  | `barrel-import-from-effect` in test files                                            | scope to src files only                                 |
  | `array-push-spread` on lines with `// eslint-disable-next-line no-restricted-syntax` | honor disable pragmas                                   |
  | `.tst.ts` runtime patterns                                                           | skip dtslint files                                      |

## 0.1.11

### Patch Changes

- 69ae884: Added effect.retry

## 0.1.10

### Patch Changes

- 0de93ce: Improve Effect-specific analysis for real-world codebases and refresh the docs case studies.

  `effect-analyzer`:

  - reduce wrapper noise in explain output for service-construction files, so named operations surface instead of repeated `fn`/function-lift chatter
  - improve loop and callback summaries for traversal-heavy programs, including better `forEach` callback compression and simple predicate/body recovery
  - separate production layer assemblies from test layer assemblies in project architecture output
  - normalize built-in service names in user-facing summaries so dependencies render consistently, for example `FileSystem.FileSystem`

  `effect-analyzer-docs`:

  - refresh the `foldkit`, `t3code`, and `course-video-manager` case studies against current analyzer output
  - restore Mermaid examples in the case studies
  - switch visible commands and examples to repo-relative paths instead of local absolute filesystem paths
  - remove old-vs-new comparison language so the docs describe the current behavior directly

- 1d951e6: Update GitHub workflows: fix npm upgrade command to avoid MODULE_NOT_FOUND error and upgrade Node.js from 22 to 24

## 0.1.9

### Patch Changes

- a3637cf: Added more case studies

## 0.1.8

### Patch Changes

- 08bd948: Fixes Issue #25

## 0.1.7

### Patch Changes

- 81e2c99: Added case study for foldkit

## 0.1.6

### Patch Changes

- 659891b: fix: interactive HTML viewer theme switching and playground improvements

  - Fix mermaid "Syntax error in text" when changing themes in the interactive HTML viewer — the diagram source text is now restored before re-rendering
  - Eliminate green flash on initial load by using MutationObserver to retheme SVG nodes immediately after mermaid renders, with CSS visibility gate to prevent any flash of default classDef colors
  - Replace arbitrary setTimeout delays (500ms/1000ms) with deterministic observer-based timing
  - Make sidebar responsive with minmax(260px, 380px) instead of fixed 380px
  - Add breadcrumb navigation bar to the standalone playground page
  - Add "Full page" button to open the interactive viewer in a new browser tab
  - Add favicon to the standalone playground page
  - Add debounced auto-analyze (1.5s) on textarea input with proper empty/error/success states
  - Add Playground link to README nav
  - Regenerate transfer-analysis.html demo with fixed theme switching code
  - Rewrite Semantic Diff docs with a worked example framed as reviewing an AI agent's PR, including real before/after code, railway diagrams, actual diff output, and CI regression detection patterns

## 0.1.5

### Patch Changes

- 2a22ce9: Fix Mermaid rendering edge cases to reduce diagram noise and improve correctness.

  - Remove duplicate type annotations from node labels.
  - Emit only `classDef` styles that are actually referenced by rendered nodes.
  - Prevent duplicate yield nodes from breaking conditional branch diagrams.
  - Avoid orphan rectangular nodes for decision flows.

## 0.1.4

### Patch Changes

- bab7bc5: Improve static analysis coverage for additional Effect program patterns.

  - Detect exported function declarations that are typed to return `Effect` and analyze their returned effect expressions.
  - Add support for top-level `Effect.fn(...)` / `Effect.fnUntraced(...)` curried program declarations, including traced metadata.
  - Recognize tagged template expressions (for example SQL tagged templates) as effectful operations during expression analysis.
  - Reduce false positives in project-level discovery by excluding files that only import non-program utility modules from `effect`.

## 0.1.3

### Patch Changes

- 9545bdb: - **Alias resolution**: Follow multi-level re-export chains so Effect-like imports resolve through barrels and nested re-exports.
  - **Control-flow & patterns**: Match `COLLECTION` / `CONDITIONAL` patterns using the final method name only; merge `Effect.withSpan` into the parent node as metadata instead of a standalone child; stop treating `Schema.decodeUnknown` as a loop; resolve generic error type `E` from inner expression types where applicable.
  - **Generator IR**: Use clearer labels for `yield*` steps (e.g. from assigned names).
  - **Diff**: Match programs with content-based fingerprints for stability; cap verbose node labels and `iterSource` text length (60 chars) to keep diffs readable.
  - **Output**: Truncate user-visible labels (mermaid, explain, docs, HTML, timeline, concurrency, railway, causes) to the same default length as IR display names via `truncateDisplayText` / `DEFAULT_LABEL_MAX`.
  - **Types**: When error type is parsed from type text as a single-letter generic (e.g. `E`), run the same inner-expression resolution as for checker-based extraction.
  - **Tests**: Expand `quality-fixes` (Schema.decode, multi-withSpan, chained `pipe`), add `type-extractor-generic-e` tests, and cap Vitest `maxWorkers` at 50% to reduce flaky timeouts on heavy ts-morph suites.

## 0.1.2

### Patch Changes

- 9ea3234: Add `repository`, `bugs`, and `homepage` to package metadata so npm provenance and OIDC trusted publishing can validate the source repo.

  Resolve `@typescript-eslint/require-await` in the CLI (`Effect.tryPromise` no longer uses an `async` callback without `await`) and in a couple of tests that did not need `async`.

## 0.1.1

### Patch Changes

- f68fa1a: Tighten `Effect.gen` call detection: require the callee to end with `.gen` instead of matching `.gen` anywhere in the expression text, so unrelated identifiers are not mistaken for `gen` programs.
