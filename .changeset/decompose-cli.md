---
'effect-analyzer': patch
---

Decompose `cli.ts`.

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
