/**
 * Single-file analysis: the default mode.
 *
 * Runs the analyzer over one file, renders the requested format, and writes
 * whatever side artefacts the flags ask for (colocated markdown, test stubs,
 * quality hints).
 */

/**
 * CLI entry point for effect-analyzer
 */

import "./register-node-ts-morph"
import { Console, Effect } from "effect"
import * as fs from "node:fs/promises"
import { dirname, join, resolve } from "path"
import { getCached, setCached } from "./analysis-cache"
import { countMeaningfulNodes, toAsciiText } from "./analysis-utils"
import { analyze } from "./analyze"
import type { CLIOptions, TestRunner } from "./cli-options"
import { cliFail, cliTry, createStyle, displayPath } from "./cli-support"
import { computeDiagramFidelity, formatDiagramFidelity } from "./diagram-fidelity"
import { computeProgramDiagramQuality, type DiagramQualityHintInput } from "./diagram-quality"
import { loadDiagramQualityHintsFromEslintJson } from "./diagram-quality-eslint"
import { selectFormats } from "./output/auto-format"
import { writeColocatedOutputForFile } from "./output/colocate"
import { renderExplanation, renderMultipleExplanations } from "./output/explain"
import { renderJSON, renderMultipleJSON } from "./output/json"
import { renderDependencyMatrix } from "./output/matrix"
import {
  renderEnhancedMermaid,
  renderMermaid,
  renderMermaidWithRuntimeTrace,
  renderPathsMermaid,
  renderStaticMermaid
} from "./output/mermaid"
import { renderCausesMermaid } from "./output/mermaid-causes"
import { renderConcurrencyMermaid } from "./output/mermaid-concurrency"
import { renderDataflowMermaid } from "./output/mermaid-dataflow"
import { renderDecisionsMermaid } from "./output/mermaid-decisions"
import { renderErrorsMermaid } from "./output/mermaid-errors"
import { renderLayersMermaid, renderProgramsLayersMermaid } from "./output/mermaid-layers"
import { renderRailwayMermaid } from "./output/mermaid-railway"
import { renderRetryMermaid } from "./output/mermaid-retry"
import { renderServicesMermaid } from "./output/mermaid-services"
import { renderTestabilityMermaid } from "./output/mermaid-testability"
import { renderTimelineMermaid } from "./output/mermaid-timeline"
import { generateMultipleShowcase } from "./output/showcase"
import { renderMultipleSummaries } from "./output/summary"
import { formatTestMatrixAsCode, generateTestMatrix } from "./output/test-matrix"
import { generatePaths } from "./path-generator"
import { extractProjectArchitecture, renderProjectArchitecture } from "./project-architecture"
import { type SpanTree, traceFromSpanTree } from "./runtime-trace"
import { isTrivialProgram } from "./trivial-programs"
import type { DiagramQuality, StaticEffectIR } from "./types"

export const loadQualityHintsByFile = (
  options: CLIOptions,
  style: ReturnType<typeof createStyle>
): Effect.Effect<Map<string, DiagramQualityHintInput>> =>
  Effect.gen(function*() {
    if (!options.quality || !options.qualityEslint) {
      return new Map<string, DiagramQualityHintInput>()
    }
    const eslintPath = resolve(options.qualityEslint)
    const hints = yield* cliTry(() => loadDiagramQualityHintsFromEslintJson(eslintPath)).pipe(
      Effect.catch((error) =>
        Effect.gen(function*() {
          yield* Console.error(
            style.yellow(
              `Warning: could not load --quality-eslint file (${String(error)}). Continuing without ESLint hints.`
            )
          )
          return new Map<string, DiagramQualityHintInput>()
        })
      )
    )
    return hints
  })

export const buildProgramQualities = (
  irs: ReadonlyArray<StaticEffectIR>,
  hintsByFile: ReadonlyMap<string, DiagramQualityHintInput>,
  styleGuide: boolean
): Map<string, DiagramQuality> => {
  const out = new Map<string, DiagramQuality>()
  for (const ir of irs) {
    const hints = hintsByFile.get(resolve(ir.metadata.filePath))
    const quality = computeProgramDiagramQuality(ir, {
      styleGuideSummary: styleGuide,
      hints
    })
    out.set(ir.root.id, quality)
  }
  return out
}

/** Sanitize a program name into a safe filename. */
export const sanitizeProgramName = (name: string): string => name.replace(/[^a-zA-Z0-9_.-]/g, "_")

/**
 * Write a `{programName}.test.ts` stub next to `sourcePath` for each IR.
 * Skips files that already exist unless `overwrite` is true.
 */
export const writeTestStubsForFile = (
  sourcePath: string,
  irs: ReadonlyArray<StaticEffectIR>,
  testRunner: TestRunner,
  overwrite: boolean
) =>
  Effect.gen(function*() {
    const results: Array<{ path: string; skipped: boolean }> = []
    const dir = dirname(sourcePath)
    const seen = new Set<string>()
    for (const ir of irs) {
      const name = sanitizeProgramName(ir.root.programName || "program")
      let target = join(dir, `${name}.test.ts`)
      // Disambiguate if multiple programs share a name after sanitization
      let suffix = 2
      while (seen.has(target)) {
        target = join(dir, `${name}.${String(suffix++)}.test.ts`)
      }
      seen.add(target)

      const exists = yield* cliTry(() => fs.access(target)).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false))
      )
      if (exists && !overwrite) {
        results.push({ path: target, skipped: true })
        continue
      }

      const paths = generatePaths(ir)
      const matrix = generateTestMatrix(paths)
      const code = formatTestMatrixAsCode(matrix, {
        testRunner,
        programName: ir.root.programName
      })
      yield* cliTry(() => fs.writeFile(target, code, "utf-8"))
      results.push({ path: target, skipped: false })
    }
    return results
  })

export const runAnalysis = (
  resolvedPath: string,
  options: CLIOptions,
  /**
   * Where the rendered result goes, `Console.log` by default.
   *
   * A run over several paths needs the pieces before they are printed: three
   * JSON documents written one after another do not parse as one.
   */
  emit: (rendered: string) => Effect.Effect<void> = Console.log
) =>
  Effect.gen(function*() {
    const style = createStyle(options.color && process.stdout.isTTY)

    // Every progress line goes through here so none can forget `--quiet`.
    // The counts used to ignore it while the line explaining them respected
    // it, which left `--quiet` reporting "Found 2 program(s)" above a single
    // diagram with nothing saying where the other one went.
    //
    // Progress goes to stderr: stdout carries the diagram or the JSON, and a
    // status line in the middle of it makes `> out.mmd` produce a file that
    // does not parse.
    const logProgress = (message: string): Effect.Effect<void> => options.quiet ? Effect.void : Console.error(message)

    const analyzerOptions = options.tsconfig !== undefined
      ? { tsConfigPath: options.tsconfig }
      : undefined

    let irs: ReadonlyArray<StaticEffectIR>
    const useCache = options.cache && !resolvedPath.includes("*")
    if (useCache) {
      const content = yield* cliTry(() => fs.readFile(resolvedPath, "utf-8")).pipe(
        Effect.catch(() => Effect.succeed(null as string | null))
      )
      if (content !== null) {
        const cached = yield* cliTry(() => getCached(resolvedPath, content)).pipe(
          Effect.catch(() => Effect.succeed(null))
        )
        if (cached !== null && cached.length > 0) {
          irs = cached
          yield* logProgress(`(cache hit) Found ${String(irs.length)} program(s)`)
        } else {
          irs = yield* analyze(resolvedPath, analyzerOptions)
            .all
            .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)))
          yield* cliTry(() => setCached(resolvedPath, content, irs)).pipe(Effect.ignore)
          yield* logProgress(`Found ${String(irs.length)} program(s)`)
        }
      } else {
        irs = yield* analyze(resolvedPath, analyzerOptions)
          .all
          .pipe(Effect.tapError((e) => Console.error(`Error: ${e.message}`)))
        yield* logProgress(`Found ${String(irs.length)} program(s)`)
      }
    } else {
      irs = yield* analyze(resolvedPath, analyzerOptions)
        .all
        .pipe(Effect.tapError((error) => Console.error(`Error: ${error.message}`)))
      yield* logProgress(`Found ${String(irs.length)} program(s)`)
    }

    const minN = options.minMeaningfulNodes
    let filteredIrs: ReadonlyArray<StaticEffectIR> = minN !== undefined
      ? irs.filter((ir) => countMeaningfulNodes(ir.root.children) >= minN)
      : irs
    if (minN !== undefined && filteredIrs.length !== irs.length) {
      yield* logProgress(
        `Filtered ${String(irs.length - filteredIrs.length)} low-signal program(s) with --min-meaningful-nodes=${
          String(minN)
        }`
      )
    }

    // --program picks one program by name. Naming it is an explicit request, so
    // the trivial filter does not apply.
    if (options.program !== undefined) {
      const wanted = options.program
      const selected = filteredIrs.filter((ir) => ir.root.programName === wanted)
      if (selected.length === 0) {
        const names = [...new Set(filteredIrs.map((ir) => ir.root.programName))]
        return yield* cliFail(
          `No program named "${wanted}" in ${displayPath(resolvedPath)}. Programs: ${names.join(", ") || "(none)"}`
        )
      }
      filteredIrs = selected
    } else if (!options.includeTrivial) {
      // Filter trivial programs by default (class definitions, schema declarations,
      // runPromise entrypoints, single-expression direct programs)
      const beforeCount = filteredIrs.length
      filteredIrs = filteredIrs.filter((program) => !isTrivialProgram(program))
      const removed = beforeCount - filteredIrs.length
      if (removed > 0) {
        yield* logProgress(`Filtered ${String(removed)} trivial program(s) (use --include-trivial to see all)`)
      }
    }

    if (options.assertDiagramFidelity) {
      if (filteredIrs.length === 0) {
        return yield* cliFail(
          "Diagram fidelity assertion checked no programs. " +
            "Nothing was left after filtering — pass --include-trivial, or point at a file with an Effect program."
        )
      }
      const reports = filteredIrs.map((ir) => ({
        programName: ir.root.programName,
        report: computeDiagramFidelity(ir)
      }))
      for (const { programName, report } of reports) {
        yield* Console.log(`\n${programName}:\n${formatDiagramFidelity(report)}`)
      }
      if (reports.some(({ report }) => !report.exact)) {
        return yield* cliFail("Diagram fidelity assertion failed")
      }
    }

    const qualityHintsByFile = yield* loadQualityHintsByFile(options, style)
    const programQualities = options.quality
      ? buildProgramQualities(filteredIrs, qualityHintsByFile, options.styleGuide)
      : new Map<string, DiagramQuality>()

    if (options.test && filteredIrs.length > 0) {
      const results = yield* writeTestStubsForFile(
        resolvedPath,
        filteredIrs,
        options.testRunner,
        options.testOverwrite
      )
      for (const r of results) {
        if (r.skipped) {
          yield* Console.log(style.dim(`  Test (skipped, exists): ${r.path}`))
        } else {
          yield* Console.log(style.green("  Test: ") + style.cyan(r.path))
        }
      }
    }

    // Single file: write the adjacent markdown and still print the diagram.
    // An explicit -o names where output goes, so it opts out unless --colocate.
    // A --program run shows part of the file, so it must not overwrite the
    // colocated analysis of the whole file.
    if (
      !options.noColocate && options.program === undefined && (options.output === undefined || options.colocate)
    ) {
      const outputFile = yield* writeColocatedOutputForFile(
        resolvedPath,
        filteredIrs,
        options.colocateSuffix,
        options.direction ?? "TB",
        options.colocateEnhanced,
        options.quality ? programQualities : undefined,
        options.styleGuide
      )
      yield* Console.error(`Written: ${displayPath(outputFile)}`)
    }

    let output = ""

    // Auto-format renderer dispatch map
    const autoRenderers: Record<string, (ir: StaticEffectIR) => string> = {
      "mermaid": (ir) => renderStaticMermaid(ir, { direction: options.direction ?? "TB" }),
      "mermaid-railway": (ir) => renderRailwayMermaid(ir, { direction: options.direction ?? "LR" }),
      "mermaid-services": (ir) => renderServicesMermaid(ir, { direction: options.direction ?? "LR" }),
      "mermaid-errors": (ir) => renderErrorsMermaid(ir, { direction: options.direction ?? "LR" }),
      "mermaid-decisions": (ir) => renderDecisionsMermaid(ir, { direction: options.direction ?? "TB" }),
      "mermaid-causes": (ir) => renderCausesMermaid(ir, { direction: options.direction ?? "TB" }),
      "mermaid-concurrency": (ir) => renderConcurrencyMermaid(ir, { direction: options.direction ?? "TB" }),
      "mermaid-timeline": (ir) => renderTimelineMermaid(ir),
      "mermaid-layers": (ir) => renderLayersMermaid(ir, { direction: options.direction ?? "TB" }),
      "mermaid-retry": (ir) => renderRetryMermaid(ir, { direction: options.direction ?? "LR" }),
      "mermaid-testability": (ir) => renderTestabilityMermaid(ir, { direction: options.direction ?? "LR" }),
      "mermaid-dataflow": (ir) => renderDataflowMermaid(ir, { direction: options.direction ?? "LR" })
    }

    switch (options.format) {
      case "auto": {
        const diagrams: Array<string> = []
        const seenContent = new Set<string>()
        for (const ir of filteredIrs) {
          const formats = selectFormats(ir)
          for (const sel of formats) {
            const programLabel = filteredIrs.length > 1 ? ` [${ir.root.programName}]` : ""

            if (sel.format === "explain") {
              const rendered = renderExplanation(ir)
              if (!seenContent.has(rendered)) {
                seenContent.add(rendered)
                diagrams.push(`%% explain${programLabel}\n${rendered}`)
              }
              continue
            }

            // Build rendered output, respecting detail level if specified
            let rendered: string
            if (sel.detail && sel.format === "mermaid") {
              rendered = renderStaticMermaid(ir, { direction: options.direction ?? "TB", detail: sel.detail })
            } else {
              const renderer = autoRenderers[sel.format]
              if (!renderer) continue
              rendered = renderer(ir)
            }

            // Skip empty/trivial diagrams
            if (
              rendered.includes("((No steps))") || rendered.includes("((No errors))") || rendered.includes("((No ")
            ) continue
            // Skip duplicate content
            if (seenContent.has(rendered)) continue
            seenContent.add(rendered)
            diagrams.push(`%% ${sel.format}${programLabel}\n${rendered}`)
          }
        }
        output = diagrams.join("\n\n")
        break
      }
      case "json": {
        if (!options.quality) {
          const firstIR = filteredIrs[0]
          if (filteredIrs.length === 1 && firstIR) {
            output = yield* renderJSON(firstIR, {
              pretty: options.pretty,
              includeMetadata: options.includeMetadata
            })
          } else {
            output = yield* renderMultipleJSON(filteredIrs, {
              pretty: options.pretty,
              includeMetadata: options.includeMetadata
            })
          }
        } else {
          const payload = filteredIrs.map((ir) => {
            const base = options.includeMetadata
              ? {
                root: ir.root,
                metadata: ir.metadata,
                references: ir.references instanceof Map
                  ? (Object.fromEntries(ir.references) as Record<string, StaticEffectIR>)
                  : ir.references
              }
              : { root: ir.root }
            const diagramQuality: DiagramQuality | undefined = programQualities.get(ir.root.id)
            return {
              ...base,
              diagramQuality
            }
          })
          output = JSON.stringify(
            payload.length === 1 ? payload[0] : payload,
            null,
            options.pretty ? 2 : undefined
          )
        }
        break
      }
      case "mermaid": {
        const traceFile = options.runtimeTrace
        const runtimeTrace = traceFile
          ? traceFromSpanTree(
            JSON.parse(
              yield* cliTry(() => fs.readFile(resolve(traceFile), "utf8"))
            ) as SpanTree
          )
          : undefined
        const mermaidOptions = {
          direction: options.direction ?? "TB",
          ...(options.detail ? { detail: options.detail } : {})
        }
        const diagrams: Array<string> = []
        for (const ir of filteredIrs) {
          if (runtimeTrace) {
            const overlay = renderMermaidWithRuntimeTrace(ir, runtimeTrace, mermaidOptions)
            diagrams.push(
              `${overlay.mermaid}\n%% runtime overlay: ` +
                `${overlay.matchedSpanIds.length} matched, ` +
                `${overlay.suffixMatchedSpanIds.length} matched by suffix, ` +
                `${overlay.unmatchedSpanIds.length} unmatched, ` +
                `${overlay.ambiguousSpanIds.length} ambiguous`
            )
            continue
          }
          diagrams.push(yield* renderMermaid(ir, mermaidOptions))
        }
        output = diagrams.join("\n\n")
        break
      }
      case "mermaid-paths": {
        const pathDiagrams: Array<string> = []
        for (const ir of filteredIrs) {
          const paths = generatePaths(ir)
          pathDiagrams.push(
            renderPathsMermaid(paths, {
              direction: options.direction ?? "TB",
              styleGuide: options.styleGuide
            })
          )
        }
        output = pathDiagrams.join("\n\n")
        break
      }
      case "mermaid-enhanced": {
        const enhancedDiagrams: Array<string> = []
        for (const ir of filteredIrs) {
          enhancedDiagrams.push(renderEnhancedMermaid(ir, {
            direction: options.direction ?? "TB",
            ...(options.detail ? { detail: options.detail } : {})
          }))
        }
        output = enhancedDiagrams.join("\n\n")
        break
      }
      case "mermaid-railway": {
        const railwayDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderRailwayMermaid(ir, { direction: railwayDir }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-services": {
        const svcDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderServicesMermaid(ir, { direction: svcDir }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-errors": {
        const errDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderErrorsMermaid(ir, { direction: errDir, when: "always" }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-decisions": {
        const outputs = filteredIrs.map((ir) => renderDecisionsMermaid(ir, { direction: options.direction ?? "TB" }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-causes": {
        const outputs = filteredIrs.map((ir) => renderCausesMermaid(ir, { direction: options.direction ?? "TB" }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-concurrency": {
        const outputs = filteredIrs.map((ir) => renderConcurrencyMermaid(ir, { direction: options.direction ?? "TB" }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-timeline": {
        const outputs = filteredIrs.map((ir) => renderTimelineMermaid(ir))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-layers": {
        // One diagram for all programs. Layer definitions are trivial programs
        // on their own, yet they are exactly what this view draws. An explicit
        // --program still narrows it to that one program.
        const layerIrs = options.program !== undefined ? filteredIrs : irs
        output = renderProgramsLayersMermaid(layerIrs, { direction: options.direction ?? "TB" })
        break
      }
      case "mermaid-retry": {
        const retryDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderRetryMermaid(ir, { direction: retryDir }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-testability": {
        const testDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderTestabilityMermaid(ir, { direction: testDir }))
        output = outputs.join("\n\n")
        break
      }
      case "mermaid-dataflow": {
        const dfDir = options.direction ?? "LR"
        const outputs = filteredIrs.map((ir) => renderDataflowMermaid(ir, { direction: dfDir }))
        output = outputs.join("\n\n")
        break
      }
      case "stats": {
        const stats = filteredIrs.map((ir) => ({
          program: ir.root.programName,
          stats: ir.metadata.stats,
          ...(options.quality
            ? { diagramQuality: programQualities.get(ir.root.id) }
            : {})
        }))
        output = JSON.stringify(stats, null, options.pretty ? 2 : undefined)
        break
      }
      case "showcase": {
        const sourceCode = yield* cliTry(() => fs.readFile(resolvedPath, "utf-8")).pipe(
          Effect.catch(() => Effect.succeed(""))
        )
        const showcaseEntries = generateMultipleShowcase(
          filteredIrs,
          { direction: options.direction ?? "TB" },
          sourceCode
        )
        const showcasePayload = showcaseEntries.length === 1 ? showcaseEntries[0] : showcaseEntries
        output = JSON.stringify(showcasePayload, null, options.pretty ? 2 : undefined)
        break
      }
      case "architecture": {
        output = renderProjectArchitecture(
          extractProjectArchitecture([resolvedPath], { tsconfig: options.tsconfig }),
          dirname(resolvedPath)
        )
        break
      }
      case "explain": {
        output = renderMultipleExplanations(filteredIrs)
        break
      }
      case "summary": {
        output = renderMultipleSummaries(filteredIrs)
        break
      }
      case "matrix": {
        output = renderDependencyMatrix(filteredIrs)
        break
      }
    }

    if (options.ascii) output = toAsciiText(output)
    const outputPath = options.output
    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, output, "utf-8"))
      yield* Console.error(`Output written to ${outputPath}`)
    } else {
      yield* emit(output)
    }
  })
