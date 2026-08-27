---
'effect-analyzer': patch
---

Fixes from a review of the probe, watch and mutation-testing work.

**Watch mode serializes its refreshes.** Rendering runs through `captureStdout`,
which swaps the global `process.stdout.write`. Only the debounce stood between
two analyses, so an analysis slower than the 300ms window overlapped the next
one — and overlapping captures restore in the order they *finish*, leaving
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

