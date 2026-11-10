/**
 * Statechart modes: diagram, coverage gate, XState export, and the local
 * visualizer page. Prefer explicit machines in source; when none are found,
 * fall back to railway-shaped Effect IR → StateMachine for linear programs.
 */

/**
 * CLI entry point for effect-analyzer
 */

import "./register-node-ts-morph"
import { Console, Effect, Option } from "effect"
import * as fs from "node:fs/promises"
import { basename, extname, join } from "path"
import type { CLIOptions } from "./cli-options"
import { cliTry, displayPath, openInBrowser } from "./cli-support"
import { writeColocatedDiagrams } from "./output/colocate"
import { renderMachineJSON } from "./output/machine-json"
import { renderStatechartMermaid } from "./output/mermaid-statechart"
import { irsToStateMachines } from "./output/railway-machine"
import { renderCoverageReport, summarizeCoverage } from "./output/statechart-coverage"
import { renderStatechartVisualizerHTML } from "./output/statechart-html"
import { renderStatechartHTML, renderStatechartSVG } from "./output/svg-statechart"
import { renderXStateConfig } from "./output/xstate-config"
import { analyzeStateMachines, type StateMachine, summarizeAlphabet } from "./state-machine"
import { computeStateMachineCoverage, type StateMachineCoverage } from "./state-machine-coverage"
import { diagnoseStateMachines } from "./state-machine-diagnostics"
import { analyzeEffectFile } from "./static-analyzer"
import { isTrivialProgram } from "./trivial-programs"

/**
 * Run a statechart format (mermaid-statechart | svg-statechart | statechart-html | xstate-config | machine-json).
 * Reads `@typeonce/effect-machine` / XState machines from source first. When
 * none are found, builds railway machines from Effect programs in the same files.
 */
export const runStatechartMode = (
  resolvedPath: string,
  options: CLIOptions
) =>
  Effect.gen(function*() {
    let files: Array<string>
    const stat = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
      Effect.option
    )
    if (Option.isSome(stat) && stat.value.isDirectory()) {
      const exts = [".ts", ".tsx"]
      const walk = async (dir: string, depth: number): Promise<Array<string>> => {
        if (depth > 10) return []
        const result: Array<string> = []
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          const full = join(dir, e.name)
          if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") {
            result.push(...(await walk(full, depth + 1)))
          } else if (e.isFile() && exts.includes(extname(e.name))) {
            result.push(full)
          }
        }
        return result
      }
      files = yield* cliTry(() => walk(resolvedPath, 0))
    } else {
      files = [resolvedPath]
    }

    const machines: Array<StateMachine> = []
    for (const file of files) {
      // Unparseable files are skipped, not fatal.
      machines.push(
        // oxlint-disable-next-line effecttsgo/effect-try-without-catch -- failure is swallowed below
        ...(yield* Effect.try(() => analyzeStateMachines(file).machines).pipe(
          Effect.orElseSucceed((): ReadonlyArray<StateMachine> => [])
        ))
      )
    }

    if (machines.length === 0) {
      const fromIr = yield* Effect.forEach(files, (file) =>
        analyzeEffectFile(file).pipe(
          Effect.map((irs) =>
            irsToStateMachines(
              options.includeTrivial ? irs : irs.filter((ir) => !isTrivialProgram(ir))
            )
          ),
          Effect.orElseSucceed((): ReadonlyArray<StateMachine> => [])
        ))
      machines.push(...fromIr.flat())
    }

    if (machines.length === 0) {
      const rejections = files.flatMap((file) => {
        try {
          return [...diagnoseStateMachines(file).rejected]
        } catch {
          return []
        }
      })
      if (rejections.length === 0) {
        yield* Console.error(
          "No state machines found. Pass a Machine.make(...).handle(...) / XState machine, or an Effect program with railway steps. See https://jagreehal.github.io/effect-analyzer/reference/state-machines/."
        )
      } else {
        yield* Console.error(
          `No state machines found, but ${rejections.length} declaration${
            rejections.length === 1 ? "" : "s"
          } came close:`
        )
        for (const r of rejections) {
          const loc = r.location
            ? ` ${basename(r.location.filePath)}:${r.location.line}`
            : ""
          yield* Console.error(`  • ${r.name} (${r.kind})${loc}`)
          yield* Console.error(`      ${r.reason}`)
          yield* Console.error(`      fix: ${r.hint}`)
        }
      }
      return
    }

    const coverages: Array<StateMachineCoverage> = machines.map(
      computeStateMachineCoverage
    )

    // Summary header to stderr so stdout (config/diagram) stays pipe-clean.
    if (!options.quiet) {
      yield* Console.error(
        `Found ${machines.length} state machine${machines.length === 1 ? "" : "s"}:`
      )
      for (const m of machines) {
        const { states: stateCount, events: eventCount } = summarizeAlphabet(m)
        yield* Console.error(
          `  • ${m.name}: ${stateCount} state${stateCount === 1 ? "" : "s"}, ${eventCount} event${
            eventCount === 1 ? "" : "s"
          }` +
            (m.alphabetSource ? ` (${m.alphabetSource})` : "")
        )
      }
    }

    let output: string
    if (options.format === "xstate-config") {
      output = machines.map(renderXStateConfig).join("\n\n")
    } else if (options.format === "machine-json") {
      output = renderMachineJSON(machines)
    } else if (options.format === "statechart-html") {
      output = renderStatechartVisualizerHTML(machines, coverages)
    } else if (options.format === "svg-statechart") {
      output = renderStatechartHTML(
        machines.map((m, i) => renderStatechartSVG(m, coverages[i]))
      )
    } else if (options.format === "statechart-coverage") {
      const summary = summarizeCoverage(coverages, options.minCoverage)
      output = options.coverageJson
        ? JSON.stringify({ machines: coverages, summary }, null, options.pretty ? 2 : undefined)
        : renderCoverageReport(coverages, { minCoverage: options.minCoverage })
      // Non-zero exit for CI on any warning or sub-threshold machine.
      if (!summary.passed) {
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }
    } else {
      const diagrams = machines.map((m, i) => renderStatechartMermaid(m, coverages[i]))
      output = diagrams.join("\n\n")
      // Same rule as the other mermaid-* formats: a single file colocates the diagram.
      const colocate = files[0] === resolvedPath && !options.noColocate && options.program === undefined &&
        (options.output === undefined || options.colocate)
      if (colocate) {
        const outputFile = yield* writeColocatedDiagrams(resolvedPath, options.colocateSuffix, diagrams)
        yield* Console.error(`Written: ${displayPath(outputFile)}`)
      }
    }

    // HTML formats are documents, not pipeable text: when no -o is given, write
    // a file next to the input and print its path rather than dumping markup.
    const isHtml = options.format === "statechart-html" ||
      options.format === "svg-statechart"
    const firstFile = files[0]
    const defaultHtmlPath = files.length === 1 && firstFile
      ? `${basename(firstFile).replace(/\.[^.]+$/, "")}.statechart.html`
      : "effect-statecharts.html"
    const outputPath = options.output ?? (isHtml ? defaultHtmlPath : undefined)

    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, output, "utf-8"))
      yield* Console.log(
        isHtml ? `Statechart written to ${outputPath}` : `Output written to ${outputPath}`
      )
      if (options.open && isHtml) {
        yield* Console.log(`Opening ${outputPath}…`)
        yield* openInBrowser(outputPath)
      }
    } else {
      yield* Console.log(output)
    }
  })
