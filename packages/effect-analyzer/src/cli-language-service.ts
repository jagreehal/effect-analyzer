/**
 * Effect language service findings for the analysis modes.
 *
 * They go to stderr, which leaves a redirected diagram or JSON document as it is.
 */

import { Console, Effect } from "effect"
import { resolve } from "node:path"
import type { CLIOptions } from "./cli-options"
import { displayPath } from "./cli-support"
import { checkFilesWithTsgo, fileImportsEffect, type TsgoCheck } from "./tsgo-diagnostics"

export const tsgoNotices = (
  coverage: { readonly skipped?: ReadonlyArray<string> | undefined; readonly unchecked: ReadonlyArray<string> }
): ReadonlyArray<string> => [
  ...(coverage.skipped ?? []).map((reason) => `Effect type-aware checks skipped: ${reason}`),
  ...(coverage.unchecked.length > 0
    ? [`Effect type-aware checks did not cover ${String(coverage.unchecked.length)} file(s).`]
    : [])
]

/** Errors and warnings as `path:line:column - severity rule: message`, then what was not checked. */
export const renderTsgoCheck = (files: ReadonlyArray<string>, check: TsgoCheck): ReadonlyArray<string> => [
  ...check.diagnostics
    .filter((d) => d.severity !== "info")
    .map((d) =>
      `${displayPath(d.filePath)}:${String(d.line)}:${String(d.column)} - ${d.severity} ${d.rule}: ${d.message}`
    ),
  ...tsgoNotices({
    skipped: check.skipped,
    unchecked: files.filter((f) => !check.checked.has(f) && fileImportsEffect(f))
  })
]

export const reportLanguageService = (paths: ReadonlyArray<string>, options: CLIOptions): Effect.Effect<void> =>
  Effect.gen(function*() {
    if (options.quiet || !options.tsgo || paths.length === 0) return
    const files = paths.map((p) => resolve(p))
    const check = yield* Effect.sync(() => checkFilesWithTsgo(files, { tsconfig: options.tsconfig }))
    for (const line of renderTsgoCheck(files, check)) yield* Console.error(line)
  })
