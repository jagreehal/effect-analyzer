import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const SOURCE = `
import { Data, Effect } from 'effect';

class NotFound extends Data.TaggedError('NOT_FOUND')<{ readonly id: string }> {}

const getUser = (id: string): Effect.Effect<{ id: string }, NotFound> =>
  Effect.succeed({ id });

export const fetchUser = Effect.gen(function* () {
  const user = yield* getUser('1');
  return user;
});
`

const runCli = (file: string, extraArgs: ReadonlyArray<string> = []) => {
  const repoRoot = resolve(__dirname, "..")
  return spawnSync(
    process.execPath,
    [join(repoRoot, "dist/cli.js"), file, ...extraArgs],
    { cwd: repoRoot, encoding: "utf8" }
  )
}

describe("cli single-file adjacent markdown", () => {
  it("writes colocated markdown by default and still prints the diagram", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-colocate-"))
    const file = join(root, "program.ts")
    try {
      writeFileSync(file, SOURCE, "utf8")
      const result = runCli(file, ["--quiet"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("flowchart")
      expect(result.stdout).not.toContain("{ user")
      const written = join(root, "program.effect-analysis.md")
      expect(existsSync(written)).toBe(true)
      expect(readFileSync(written, "utf8")).toContain("flowchart")
      expect(readFileSync(written, "utf8")).not.toContain("# Effect Analysis: {")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("writes the same report on every run, with no absolute path", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-stable-"))
    const file = join(root, "program.ts")
    const written = join(root, "program.effect-analysis.md")
    try {
      writeFileSync(file, SOURCE, "utf8")
      expect(runCli(file, ["--quiet"]).status).toBe(0)
      const first = readFileSync(written, "utf8")
      expect(runCli(file, ["--quiet"]).status).toBe(0)
      expect(readFileSync(written, "utf8")).toBe(first)
      expect(first).toContain("- **File**: `program.ts`")
      expect(first).not.toContain(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("skips the adjacent file with --no-colocate", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-nocolocate-"))
    const file = join(root, "program.ts")
    try {
      writeFileSync(file, SOURCE, "utf8")
      const result = runCli(file, ["--no-colocate", "--quiet"])
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("flowchart")
      expect(existsSync(join(root, "program.effect-analysis.md"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("skips the adjacent file when -o is given, unless --colocate", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-output-"))
    const file = join(root, "program.ts")
    const out = join(root, "out.json")
    try {
      writeFileSync(file, SOURCE, "utf8")
      expect(runCli(file, ["-f", "json", "-o", out, "--quiet"]).status).toBe(0)
      expect(existsSync(out)).toBe(true)
      expect(existsSync(join(root, "program.effect-analysis.md"))).toBe(false)

      expect(runCli(file, ["-f", "json", "-o", out, "--colocate", "--quiet"]).status).toBe(0)
      expect(existsSync(join(root, "program.effect-analysis.md"))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("writes only the fenced diagram for an explicit mermaid format", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-diagram-"))
    const file = join(root, "program.ts")
    try {
      writeFileSync(file, SOURCE, "utf8")
      expect(runCli(file, ["-f", "mermaid-railway", "--quiet"]).status).toBe(0)
      const written = readFileSync(join(root, "program.effect-analysis.md"), "utf8")
      expect(written.startsWith("```mermaid\nflowchart LR\n")).toBe(true)
      expect(written.trimEnd().endsWith("```")).toBe(true)
      expect(written).not.toContain("## Metadata")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it("colocates mermaid-statechart the same way", () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-statechart-"))
    const file = join(root, "program.ts")
    const written = join(root, "program.effect-analysis.md")
    try {
      writeFileSync(file, SOURCE, "utf8")
      expect(runCli(file, ["-f", "mermaid-statechart", "--no-colocate"]).status).toBe(0)
      expect(existsSync(written)).toBe(false)
      expect(runCli(file, ["-f", "mermaid-statechart"]).status).toBe(0)
      expect(readFileSync(written, "utf8").startsWith("```mermaid\nstateDiagram-v2\n")).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})
