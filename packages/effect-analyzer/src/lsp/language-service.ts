/**
 * Effect language service findings for open documents.
 *
 * The rules need types and a process of their own, so a check runs the CLI on the
 * file as saved, and its findings count only for the text they came from.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Diagnostic, DiagnosticSeverity } from "vscode-languageserver"
import type { TextDocument } from "vscode-languageserver-textdocument"
import { loadTsMorph } from "../ts-morph-loader"
import { nearestTsconfig } from "../tsconfigs"
import { parseTsgoOutput, type TsgoDiagnostic } from "../tsgo-diagnostics"

const SEVERITY: Record<TsgoDiagnostic["severity"], DiagnosticSeverity> = { error: 1, warning: 2, info: 3 }

const toDiagnostic = (d: TsgoDiagnostic): Diagnostic => ({
  range: {
    start: { line: d.line - 1, character: d.column - 1 },
    end: { line: d.endLine - 1, character: d.endColumn - 1 }
  },
  message: d.message,
  severity: SEVERITY[d.severity],
  source: "effect",
  code: d.rule
})

/**
 * Whether the file's tsconfig already configures the Effect language service.
 * An editor set up for it shows these findings itself.
 */
const configuresLanguageService = (filePath: string): boolean => {
  const { ts } = loadTsMorph()
  const config = nearestTsconfig(dirname(filePath))
  if (config === undefined) return false
  const { config: json } = ts.readConfigFile(config, (path) => ts.sys.readFile(path))
  // Only the options are wanted, with `extends` resolved, so list no files.
  const { options } = ts.parseJsonConfigFileContent(json, { ...ts.sys, readDirectory: () => [] }, dirname(config))
  const plugins: unknown = options["plugins"]
  return Array.isArray(plugins) &&
    plugins.some((plugin: { name?: unknown }) => plugin.name === "@effect/language-service")
}

const isCheckable = (filePath: string, text: string): boolean => {
  try {
    return readFileSync(filePath, "utf-8") === text && !configuresLanguageService(filePath)
  } catch {
    return false
  }
}

const startCheck = (filePath: string) =>
  spawn(
    process.execPath,
    [
      fileURLToPath(new URL("../cli.js", import.meta.url)),
      "diagnostics",
      "--no-analyzer",
      "--format",
      "json",
      "--file",
      filePath
    ],
    {
      cwd: dirname(filePath),
      stdio: ["ignore", "pipe", "ignore"],
      detached: process.platform !== "win32",
      windowsHide: true
    }
  )

/**
 * Stop a check and everything it started: the CLI launches `@effect/tsgo`, which
 * launches the native compiler.
 */
const killTree = ({ pid }: ChildProcess): void => {
  if (pid === undefined) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {})
    return
  }
  try {
    // Checks lead their own process group, so this reaches the whole tree.
    process.kill(-pid, "SIGKILL")
  } catch {
    // Already gone.
  }
}

/** `onFindings` is called with a document's uri when a check of it has finished. */
export const makeLanguageService = (onFindings: (uri: string) => void) => {
  const findings = new Map<string, { readonly version: number; readonly diagnostics: ReadonlyArray<Diagnostic> }>()
  const runs = new Map<string, { readonly child: ChildProcess; readonly version: number }>()

  const stop = (uri: string): void => {
    const run = runs.get(uri)
    runs.delete(uri)
    if (run) killTree(run.child)
  }

  return {
    check: (doc: TextDocument): void => {
      const { uri, version } = doc
      stop(uri)
      if (!uri.startsWith("file:") || !isCheckable(fileURLToPath(uri), doc.getText())) return
      const child = startCheck(fileURLToPath(uri))
      runs.set(uri, { child, version })
      const chunks: Array<Buffer> = []
      const isCurrent = () => runs.get(uri)?.child === child
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
      child.on("error", () => {
        if (isCurrent()) runs.delete(uri)
      })
      child.on("close", () => {
        if (!isCurrent()) return
        runs.delete(uri)
        // Exit 1 only means findings; no parseable report means it could not run.
        const result = parseTsgoOutput(Buffer.concat(chunks).toString("utf-8"))
        if (!result) return
        findings.set(uri, { version, diagnostics: result.diagnostics.map(toDiagnostic) })
        onFindings(uri)
      })
    },
    /** Stop a check of any other version of a document. */
    edited: (uri: string, version: number): void => {
      if (runs.get(uri)?.version !== version) stop(uri)
    },
    closed: (uri: string): void => {
      findings.delete(uri)
      stop(uri)
    },
    findingsFor: (uri: string, version: number): ReadonlyArray<Diagnostic> => {
      const found = findings.get(uri)
      return found?.version === version ? found.diagnostics : []
    },
    stopAll: (): void => {
      for (const uri of runs.keys()) stop(uri)
    }
  }
}
