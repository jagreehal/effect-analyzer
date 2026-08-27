---
'effect-analyzer': patch
---

Add mutation testing (Stryker), and close the gaps it found.

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
