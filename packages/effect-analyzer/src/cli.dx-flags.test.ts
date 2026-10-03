/**
 * CLI flags for focused output: picking one program out of a file,
 * cwd-relative paths in human output, migration reports as JSON/markdown,
 * and the single-analyzer reports on a single file.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const PROGRAMS = `
import { Effect } from 'effect';
export const transfer = Effect.gen(function* () {
  yield* Effect.log('debit');
  yield* Effect.log('credit');
});
export const refund = Effect.gen(function* () {
  const amount = yield* Effect.succeed(10);
  yield* Effect.log(\`refund \${amount}\`);
});
`

const LEGACY = `
export async function load(ids: string[]) {
  try {
    return await Promise.all(ids.map((id) => fetch(id)));
  } catch (e) {
    throw new Error('failed');
  }
}
`

const LAYERS = `
import { Context, Effect, Layer } from 'effect';
class A extends Context.Service<A, { readonly a: Effect.Effect<void> }>()('A') {}
class B extends Context.Service<B, { readonly b: Effect.Effect<void> }>()('B') {}
export const ALive = Layer.succeed(A, { a: Effect.void });
export const BLive = Layer.succeed(B, { b: Effect.void });
`

let root: string

const cli = resolve(__dirname, "..", "dist", "cli.js")

const runCli = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, [cli, ...args, "--no-colocate"], { cwd: root, encoding: "utf8" })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "effect-analyze-dx-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(
    join(root, "tsconfig.json"),
    "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"ESNext\",\"moduleResolution\":\"bundler\",\"strict\":true}}",
    "utf8"
  )
  writeFileSync(join(root, "src", "programs.ts"), PROGRAMS, "utf8")
  writeFileSync(join(root, "src", "legacy.ts"), LEGACY, "utf8")
  writeFileSync(join(root, "src", "layers.ts"), LAYERS, "utf8")
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe("--program", () => {
  it("renders only the named program", () => {
    const all = runCli(["src/programs.ts", "--format", "mermaid", "--quiet"])
    expect(all.stdout.match(/flowchart/g)).toHaveLength(2)

    const one = runCli(["src/programs.ts", "--format", "mermaid", "--program", "refund", "--quiet"])
    expect(one.status).toBe(0)
    expect(one.stdout.match(/flowchart/g)).toHaveLength(1)
  })

  it("draws only the named layer in mermaid-layers", () => {
    const all = runCli(["src/layers.ts", "--format", "mermaid-layers", "--quiet"])
    expect(all.stdout).toContain("ALive")
    expect(all.stdout).toContain("BLive")

    const one = runCli(["src/layers.ts", "--format", "mermaid-layers", "--program", "ALive", "--quiet"])
    expect(one.status).toBe(0)
    expect(one.stdout).toContain("ALive")
    expect(one.stdout).not.toContain("BLive")
  })

  it("fails with the available names when nothing matches", () => {
    const result = runCli(["src/programs.ts", "--format", "explain", "--program", "nope"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("No program named \"nope\"")
    expect(result.stderr).toContain("transfer")
    expect(result.stderr).toContain("refund")
  })
})

describe("--direction", () => {
  it("keeps LR as the railway default and honours an explicit TB", () => {
    const byDefault = runCli(["src/programs.ts", "--format", "mermaid-railway", "--program", "refund", "--quiet"])
    expect(byDefault.stdout).toMatch(/^flowchart LR/)

    const topDown = runCli([
      "src/programs.ts",
      "--format",
      "mermaid-railway",
      "--program",
      "refund",
      "-d",
      "TB",
      "--quiet"
    ])
    expect(topDown.stdout).toMatch(/^flowchart TB/)
  })
})

describe("relative paths", () => {
  it("prints the analyzed path relative to cwd", () => {
    const result = runCli(["src/programs.ts", "--format", "explain"])
    expect(result.stderr).toContain(`Analyzing ${join("src", "programs.ts")}...`)
    expect(result.stderr).not.toContain(root)
  })
})

describe("--migration output formats", () => {
  it("prints parseable JSON with --format json", () => {
    const result = runCli(["src/legacy.ts", "--migration", "--format", "json"])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as {
      fileCount: number
      opportunities: ReadonlyArray<{ pattern: string; line: number }>
    }
    expect(parsed.fileCount).toBe(1)
    expect(parsed.opportunities.length).toBeGreaterThan(0)
  })

  it("prints a markdown table with --format markdown", () => {
    const result = runCli(["src/legacy.ts", "--migration", "--format", "markdown"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("# Migration opportunities")
    expect(result.stdout).toContain("| Location | Pattern | Suggestion |")
    expect(result.stdout).toContain(`\`${join("src", "legacy.ts")}:`)
    expect(result.stdout).not.toContain(root)
  })

  it("keeps the text report free of absolute paths", () => {
    const result = runCli(["src/legacy.ts", "--migration"])
    expect(result.stdout).toContain(`${join("src", "legacy.ts")}:`)
    expect(result.stdout).not.toContain(root)
  })
})

describe("--error-channel on a single file", () => {
  it("counts the file's programs", () => {
    const result = runCli(["src/programs.ts", "--error-channel", "--format", "json", "--quiet"])
    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { summary: { totalPrograms: number } }
    expect(parsed.summary.totalPrograms).toBeGreaterThan(0)
  })
})
