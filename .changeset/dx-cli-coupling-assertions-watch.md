---
'effect-analyzer': minor
---

Four fixes to what the analyzer could see and what the CLI would tell you.

**Type assertions no longer blind the walker.** `Effect.succeed(1) as Effect.Effect<number>` is the same effect as `Effect.succeed(1)`, but the walker stopped at the `as` and emitted an unknown node — the same for `satisfies`, `!`, `<T>` and parens. On `effect/packages/effect/src`, `Could not determine effect type` drops from 141 nodes to 29, and unknown nodes overall from 262 to 165. `unwrapExpression` already existed in `core-analysis.ts`; it moves to `analysis-utils.ts` so the program walker can reach it without an import cycle, and `state-machine-ast.ts` now re-exports it instead of carrying a fourth copy of the rule that missed `!`.

**`accidental-hub` coupling issue.** A file high on fan-in *and* fan-out is a junction, not an interface: a change to anything it imports can travel to everything that imports it. That combination was previously two ordinary warnings some distance apart in the list. It is now one issue that replaces the pair, sorts below `critical-fanin`, and enters the agent report at `P1`. Bounded below `criticalFanInThreshold`, and suppressed by a known-hub annotation. Adds `accidentalHubs` to `CouplingSummary` and `'accidental-hub'` to `CouplingIssue['type']` — both public, so an exhaustive `switch` needs the new case.

**`--help` matches the parser, and bad flag values are refused.** Seven working flags (`--diff`, `--regression`, `--include-trivial`, `--entry-points`, `--config-leaks`, `--cli-commands`, `--no-test`) and `--format migration` were undocumented; `cli-help.test.ts` now reads the parser's source and fails the build when a flag or format value is missing from the help text. `--format nosuchformat` used to leave the default in place and exit 0 — a CI typo produced the wrong artifact and passed. Unknown *and* missing values for `--format`, `--direction`, `--detail`, `--profile`, `--test-runner` and `--improve-min-priority` are now reported and exit 1. Errors print once, without the Effect `Cause`.

**`--watch` survives an atomic save.** `fs.watch(path)` watches an inode; an editor that saves by writing a temp file and renaming over the original unlinks it, and Node then delivers one `rename` event and nothing further, forever — no error, no exit, a watcher that looks healthy and has stopped watching. It now watches `dirname(path)` and filters on `basename(path)`.

**Breaking:** `parseArgs` returns `{ pathArg, options, errors }` (callers destructuring the first two are unaffected), and a command that passed an unrecognised enum value and ran anyway now exits 1.
