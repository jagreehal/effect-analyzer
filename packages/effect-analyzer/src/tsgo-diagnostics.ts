/**
 * Bridge to the official Effect language service (`@effect/tsgo`).
 *
 * `@effect/tsgo` ships ~95 *type-aware* Effect rules backed by TypeScript-Go.
 * We do not reimplement those — we shell out to its JSON diagnostics mode and
 * merge the results into our findings, so effect-analyzer stays focused on the
 * things it uniquely does (structure, diagrams, IR, migration progress).
 *
 * It is a direct dependency, and so is a TypeScript 7 it supports, so these rules
 * run with no setup. A project's own TypeScript 7 and plugin configuration win
 * when it has them, which keeps diagnostics aligned with its editor.
 */

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { memoize } from "./memoize"
import { isInside } from "./paths"
import { nodeModuleLocation } from "./register-node-ts-morph"
import { loadTsMorph } from "./ts-morph-loader"
import { makeTsconfigFinder, nearestTsconfig } from "./tsconfigs"

export interface TsgoDiagnostic {
  readonly filePath: string
  readonly rule: string
  readonly severity: "error" | "warning" | "info"
  readonly message: string
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly endColumn: number
  /** Byte offset and width of the span, as `@effect/tsgo` reports them. */
  readonly start: number
  readonly length: number
  /**
   * The synthesized TypeScript error code. Every Effect language service
   * diagnostic lives in the 377xxx range, which is what lets a consumer prove a
   * finding came from the Effect LSP rather than from the type checker.
   */
  readonly code: number
  readonly source: "tsgo"
}

/** `@effect/tsgo`'s own run summary. `filesChecked: 0` means nothing was checked. */
export interface TsgoSummary {
  readonly filesChecked: number
  /** Files skipped because their tsconfig has no `@effect/language-service` plugin. */
  readonly filesWithoutPlugin: number
  readonly totalFiles: number
  readonly errors: number
  readonly warnings: number
  readonly messages: number
}

/** A checked file and its Effect versions, from `--list-files`. */
export interface TsgoFileVersion {
  readonly file: string
  readonly detectedEffect: string
  readonly supportedEffect: string
}

export interface TsgoResult {
  readonly diagnostics: ReadonlyArray<TsgoDiagnostic>
  readonly summary: TsgoSummary
  readonly files: ReadonlyArray<TsgoFileVersion>
}

export class TsgoDiagnosticsError extends Error {
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "TsgoDiagnosticsError"
    this.cause = cause
  }
}

interface TsgoJsonDiagnostic {
  readonly file: string
  readonly start: number
  readonly length: number
  readonly line: number
  readonly column: number
  readonly endLine: number
  readonly endColumn: number
  readonly severity: "error" | "warning" | "message"
  readonly code: number
  readonly name: string
  readonly message: string
}

const resolveTsgoBinFrom = (from: string): string | undefined => {
  try {
    const require = createRequire(from)
    const manifestPath = require.resolve("@effect/tsgo/package.json")
    const manifest = require("@effect/tsgo/package.json") as {
      bin?: string | Record<string, string>
      publishConfig?: { bin?: string | Record<string, string> }
    }
    // Published builds declare the real entry under publishConfig.bin; the
    // source checkout points `bin` at a .ts file that node cannot run.
    const bin = manifest.publishConfig?.bin ?? manifest.bin
    const entry = typeof bin === "string" ? bin : bin?.["effect-tsgo"]
    if (!entry) return undefined
    return join(dirname(manifestPath), entry)
  } catch {
    return undefined
  }
}

/**
 * Absolute path to the `effect-tsgo` entry script, or `undefined` when the peer
 * is not installed.
 *
 * Tries our own package location first, then the consumer's cwd — under `npx`
 * the CLI runs from a temp dir that cannot see the project's node_modules.
 */
export const resolveTsgoBin = (from?: string): string | undefined => {
  const roots = from
    ? [from]
    : [nodeModuleLocation, join(process.cwd(), "noop.js")]
  for (const root of roots) {
    const found = resolveTsgoBinFrom(root)
    if (found) return found
  }
  return undefined
}

/**
 * Whether `@effect/tsgo` refused to run because the project's TypeScript is
 * missing, older than 7, or a version it ships no native build for.
 */
const lacksNativeTypeScript = (output: string): boolean =>
  /DiscoveryError|UnsupportedTargetPackageVersionError|ReplacementUnavailableError/.test(output)

/**
 * A directory `@effect/tsgo` can run from when the project cannot supply
 * TypeScript 7: it looks for one from its cwd, and this package depends on one.
 * Types still come from the checked project's own files.
 */
const bundledToolchainCwd = dirname(
  nodeModuleLocation.startsWith("file:") ? fileURLToPath(nodeModuleLocation) : nodeModuleLocation
)

/** Make `--project` and `--file` values independent of the cwd they are read from. */
const absolutizePaths = (argv: ReadonlyArray<string>, cwd: string): ReadonlyArray<string> =>
  argv.map((arg, i) => {
    if (argv[i - 1] === "--project" || argv[i - 1] === "--file") return resolve(cwd, arg)
    const match = /^(--project|--file)=(.*)$/s.exec(arg)
    return match ? `${match[1] ?? ""}=${resolve(cwd, match[2] ?? "")}` : arg
  })

const toSeverity = (severity: TsgoJsonDiagnostic["severity"]): TsgoDiagnostic["severity"] =>
  severity === "message" ? "info" : severity

/**
 * Absolute paths a tsconfig actually includes.
 *
 * A file we scanned that is absent from this list was never in the language
 * service's scope, so its lack of diagnostics is not evidence that it is clean.
 */
export const readTsgoProjectFiles = (projectPath: string): ReadonlyArray<string> => {
  try {
    const { Project } = loadTsMorph()
    const project = new Project({ tsConfigFilePath: projectPath })
    return project.getSourceFiles().map((f) => resolve(f.getFilePath()))
  } catch {
    return []
  }
}

export interface ParsedTsgoProjectArgument {
  readonly project: string
  readonly consumed: 0 | 1
}

/**
 * Parse bare `--tsgo` without stealing a positional source path. A separated
 * project path remains supported after the source path for compatibility;
 * option-first callers use `--tsgo=<path>` for an explicit project.
 */
export const parseTsgoProjectArgument = (
  args: ReadonlyArray<string>,
  index: number,
  hasPathArg: boolean
): ParsedTsgoProjectArgument => {
  const next = args[index + 1]
  if (hasPathArg && next !== undefined && !next.startsWith("-")) {
    return { project: next, consumed: 1 }
  }
  return { project: "tsconfig.json", consumed: 0 }
}

/** Resolve the project exactly as the child process will resolve it. */
export const resolveTsgoProjectPath = (project: string, cwd: string): string =>
  isAbsolute(project) ? project : resolve(cwd, project)

/**
 * Parse the `--format json` payload. Tolerates leading noise on stdout and
 * returns `undefined` rather than throwing on anything unexpected.
 */
export const parseTsgoOutput = (stdout: string): TsgoResult | undefined => {
  const start = stdout.indexOf("{")
  if (start === -1) return undefined
  type TsgoJsonOutput = {
    diagnostics?: ReadonlyArray<TsgoJsonDiagnostic>
    summary?: Partial<TsgoSummary>
    files?: ReadonlyArray<TsgoFileVersion>
  }
  let parsed: TsgoJsonOutput
  try {
    parsed = JSON.parse(stdout.slice(start)) as TsgoJsonOutput
  } catch {
    return undefined
  }
  const diagnostics = parsed.diagnostics
  if (!Array.isArray(diagnostics)) return undefined

  const summary = parsed.summary ?? {}
  return {
    diagnostics: diagnostics.map((d: TsgoJsonDiagnostic) => ({
      filePath: d.file,
      rule: d.name,
      severity: toSeverity(d.severity),
      message: d.message,
      line: d.line,
      column: d.column,
      endLine: d.endLine,
      endColumn: d.endColumn,
      start: d.start,
      length: d.length,
      code: d.code,
      source: "tsgo" as const
    })),
    summary: {
      filesChecked: summary.filesChecked ?? 0,
      filesWithoutPlugin: summary.filesWithoutPlugin ?? 0,
      totalFiles: summary.totalFiles ?? 0,
      errors: summary.errors ?? 0,
      warnings: summary.warnings ?? 0,
      messages: summary.messages ?? 0
    },
    files: parsed.files ?? []
  }
}

export interface TsgoProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

/**
 * Run `effect-tsgo diagnostics` with the caller's own argv and return its raw
 * output.
 *
 * Nothing here interprets or re-renders what comes back: `@effect/tsgo`
 * validates its own flags, formats its own diagnostics and chooses its own exit
 * code, which is the only way a wrapper stays identical to it across releases.
 */
export const spawnTsgoDiagnostics = (
  argv: ReadonlyArray<string>,
  options: {
    readonly cwd?: string | undefined
    readonly timeoutMs?: number | undefined
    readonly inheritStderr?: boolean | undefined
  } = {}
): TsgoProcessResult => {
  const bin = resolveTsgoBin()
  if (!bin) {
    throw new TsgoDiagnosticsError(
      "Unable to resolve @effect/tsgo. Reinstall effect-analyzer and its platform dependencies."
    )
  }
  const cwd = options.cwd ?? process.cwd()
  const result = spawnSync(process.execPath, [bin, "diagnostics", ...argv], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000,
    stdio: ["ignore", "pipe", options.inheritStderr === true ? "inherit" : "pipe"]
  })
  if (result.error) throw result.error
  if (cwd !== bundledToolchainCwd && lacksNativeTypeScript(`${result.stdout ?? ""}${result.stderr ?? ""}`)) {
    return spawnTsgoDiagnostics(absolutizePaths(argv, cwd), { ...options, cwd: bundledToolchainCwd })
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1
  }
}

export interface RunTsgoOptions {
  /** Project to check. Optional when `file` is given, as upstream allows. */
  readonly project?: string | undefined
  /** Single file to check, forwarded as `--file`. */
  readonly file?: string | undefined
  readonly cwd?: string
  readonly timeoutMs?: number
  /** Inline JSON replacing the project's plugin options, as `--lspconfig`. */
  readonly lspconfig?: string | undefined
  readonly severity?: string | undefined
  readonly strict?: boolean
  readonly progress?: boolean
}

/**
 * `--lspconfig` value that turns the language service on with its default
 * severities, for files whose tsconfig has no plugin entry.
 */
export const DEFAULT_LSPCONFIG = "{}"

/**
 * Check a project or file. The project's own plugin configuration is honoured;
 * files with none are checked with the rule defaults.
 * Throws an actionable error when the check cannot run.
 */
export const runTsgoDiagnostics = (options: RunTsgoOptions): TsgoResult => {
  const configured = runTsgoOnce(options)
  if (options.lspconfig !== undefined || configured.summary.filesWithoutPlugin === 0) return configured

  const defaults = runTsgoOnce({ ...options, lspconfig: DEFAULT_LSPCONFIG })
  // `--lspconfig` replaces every file's configuration, so take from this run
  // only the files the configured run did not check.
  const checked = new Set(configured.files.map((f) => f.file))
  const diagnostics = [
    ...configured.diagnostics,
    ...defaults.diagnostics.filter((d) => !checked.has(d.filePath))
  ]
  const count = (severity: TsgoDiagnostic["severity"]) => diagnostics.filter((d) => d.severity === severity).length
  const files = [...configured.files, ...defaults.files.filter((f) => !checked.has(f.file))]
  return {
    diagnostics,
    files,
    summary: {
      filesChecked: files.length,
      filesWithoutPlugin: configured.summary.filesWithoutPlugin,
      totalFiles: defaults.summary.totalFiles,
      errors: count("error"),
      warnings: count("warning"),
      messages: count("info")
    }
  }
}

export const importsEffect = (source: string): boolean => /["'](?:effect|@effect)["'/]/.test(source)

export const fileImportsEffect = (path: string): boolean => {
  try {
    return importsEffect(readFileSync(path, "utf-8"))
  } catch {
    return false
  }
}

const EFFECT_UNRESOLVED = "the effect package could not be resolved (are dependencies installed?)"

/**
 * The files whose types were there to check. With `effect` unresolvable every
 * Effect is `any` and no rule fires, so a file that imports it was not checked.
 */
const checkedFiles = (files: ReadonlyArray<TsgoFileVersion>): ReadonlyArray<string> =>
  files
    .filter((f) => f.detectedEffect !== "unknown" || !fileImportsEffect(f.file))
    .map((f) => f.file)

export interface TsgoCheck {
  readonly diagnostics: ReadonlyArray<TsgoDiagnostic>
  /** Absolute paths the language service checked, each with its tsconfig where that is known. */
  readonly checked: ReadonlyMap<string, string | undefined>
  /** Why some files could not be checked, one line each. */
  readonly skipped: ReadonlyArray<string>
  readonly totalFiles: number
}

const toCheck = (result: TsgoResult, { file, project }: RunTsgoOptions): TsgoCheck => {
  const checked = new Map(checkedFiles(result.files).map((f) => [resolve(f), project]))
  return {
    diagnostics: result.diagnostics,
    checked,
    skipped: checked.size < result.files.length ? [`${String(project ?? file)}: ${EFFECT_UNRESOLVED}`] : [],
    totalFiles: result.summary.totalFiles
  }
}

/** Check a project the caller asked for by name: throws when it cannot run. */
export const checkProjectWithTsgo = (project: string): TsgoCheck =>
  toCheck(runTsgoDiagnostics({ project }), { project })

/** The part of a project's check that concerns `wanted`, or why there is none. */
const checkQuietly = (options: RunTsgoOptions, wanted: ReadonlySet<string>): TsgoCheck => {
  try {
    const result = runTsgoDiagnostics(options)
    return toCheck({
      ...result,
      diagnostics: result.diagnostics.filter((d) => wanted.has(d.filePath)),
      files: result.files.filter((f) => wanted.has(f.file))
    }, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const skipped = [`${String(options.project ?? options.file)}: ${message.split("\n")[0] ?? message}`]
    return { diagnostics: [], checked: new Map(), skipped, totalFiles: 0 }
  }
}

interface CheckFilesOptions {
  /** The project to check every file under, rather than each under its own. */
  readonly tsconfig?: string | undefined
  /** The directory to look for projects in, instead of the repository of each file. */
  readonly within?: string | undefined
}

/**
 * Check files under `tsconfig` when one was selected, or each under the innermost
 * around it that includes it.
 *
 * A project it cannot run on (no tsconfig, an unsupported platform) is in `skipped`.
 */
export const checkFilesWithTsgo = (
  files: ReadonlyArray<string>,
  { tsconfig, within }: CheckFilesOptions = {}
): TsgoCheck => {
  const wanted = new Set(files)
  const totalFiles = wanted.size
  if (tsconfig !== undefined) return { ...checkQuietly({ project: tsconfig }, wanted), totalFiles }

  const including = makeTsconfigFinder(within)
  const nearest = memoize((dir) => nearestTsconfig(dir, within))
  // One that no tsconfig includes can still be imported by a file of its nearest.
  const tsconfigOf = memoize((file) => including(file) ?? nearest(dirname(file)))
  const [only] = files
  if (only !== undefined && totalFiles === 1 && tsconfigOf(only) === nearest(dirname(only))) {
    const check = checkQuietly({ file: only, cwd: dirname(only) }, wanted)
    return { ...check, checked: new Map([...check.checked.keys()].map((f) => [f, including(f)])), totalFiles }
  }

  const checks = [...new Set(files.map(tsconfigOf))]
    .filter((project) => project !== undefined)
    .map((project) => ({ project, ...checkQuietly({ project }, wanted) }))
    // So that of the others that checked a file, the innermost around it is found first.
    .sort((a, b) => dirname(b.project).length - dirname(a.project).length)
  const checkOf = new Map(
    files.flatMap((file) => {
      const having = checks.filter((c) => c.checked.has(file))
      const check = having.find((c) => c.project === tsconfigOf(file)) ??
        having.find((c) => isInside(file, dirname(c.project))) ??
        having[0]
      return check ? [[file, check] as const] : []
    })
  )
  const withoutProject = files.filter((f) => tsconfigOf(f) === undefined && fileImportsEffect(f))
  return {
    diagnostics: checks.flatMap((check) =>
      check.diagnostics.filter((d) => (checkOf.get(d.filePath) ?? check) === check)
    ),
    checked: new Map([...checkOf].map(([file, { project }]) => [file, project])),
    skipped: [
      ...checks.flatMap((check) => check.skipped),
      ...new Set(withoutProject.map((f) => `${dirname(f)}: no tsconfig.json found`))
    ],
    totalFiles
  }
}

const runTsgoOnce = (options: RunTsgoOptions): TsgoResult => {
  const projectPath = options.project === undefined
    ? undefined
    : resolveTsgoProjectPath(options.project, options.cwd ?? process.cwd())
  // When the caller supplies an absolute project from another cwd, execute in
  // the project directory so effect-tsgo resolves that consumer's TypeScript
  // and Effect packages rather than packages belonging to the host process.
  const cwd = options.cwd ?? (projectPath === undefined ? process.cwd() : dirname(projectPath))

  const run = spawnTsgoDiagnostics(
    [
      ...(projectPath === undefined ? [] : ["--project", projectPath]),
      ...(options.file === undefined ? [] : ["--file", options.file]),
      "--format",
      "json",
      ...(options.severity === undefined ? [] : ["--severity", options.severity]),
      ...(options.strict === true ? ["--strict"] : []),
      ...(options.progress === true ? ["--progress"] : []),
      "--list-files",
      ...(options.lspconfig === undefined ? [] : ["--lspconfig", options.lspconfig])
    ],
    { cwd, timeoutMs: options.timeoutMs, inheritStderr: options.progress }
  )

  // A non-zero exit just means diagnostics were found; only the absence of a
  // report means the run failed, and the reason is on either stream.
  const result = parseTsgoOutput(run.stdout)
  if (result) return result
  const target = projectPath ?? options.file ?? "(no target)"
  const detail = run.stderr.trim() || run.stdout.trim()
  throw new TsgoDiagnosticsError(
    detail.length > 0
      ? `@effect/tsgo diagnostics failed: ${detail}`
      : `@effect/tsgo diagnostics failed for ${target}`
  )
}
