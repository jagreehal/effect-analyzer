import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const BEFORE = `
export class TimedOut extends Error {}

export async function charge(fn: () => Promise<string>, attempts: number) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new TimedOut();
}
`

const AFTER = `
import { Effect, Schedule, Schema } from "effect";

export class TimedOut extends Schema.TaggedError<TimedOut>()("TimedOut", {}) {}

export const charge = (fn: () => Promise<string>) =>
  Effect.tryPromise({ try: fn, catch: () => new TimedOut() }).pipe(
    Effect.retry({ schedule: Schedule.exponential("10 millis"), times: 3 })
  );
`

describe("cli --diff with a non-Effect before file", () => {
  const run = (...extra: Array<string>) => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-diff-migration-"))
    try {
      writeFileSync(
        join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" } }),
        "utf8"
      )
      writeFileSync(join(root, "before.ts"), BEFORE, "utf8")
      writeFileSync(join(root, "after.ts"), AFTER, "utf8")
      return spawnSync(
        process.execPath,
        [join(resolve(__dirname, ".."), "dist/cli.js"), "--diff", "before.ts", "after.ts", ...extra],
        { cwd: root, encoding: "utf8" }
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("reports before's migration opportunities against after's programs", () => {
    const result = run()
    expect(result.stderr).not.toContain("No Effect programs found")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("before.ts` has no Effect programs")
    expect(result.stdout).toMatch(/\d+ opportunities \(2 patterns\) -> \d+ programs; E = TimedOut;/)
    expect(result.stdout).toContain("**retry loop** -> Effect.retry + Schedule.exponential")
    expect(result.stdout).toContain("| `charge` |")
  }, 20_000)

  it("emits the same summary as JSON with --format json", () => {
    const result = run("--format", "json")
    expect(result.status).toBe(0)
    const json = JSON.parse(result.stdout) as { kind: string; patternCount: number; errorTypes: Array<string> }
    expect(json.kind).toBe("migration")
    expect(json.patternCount).toBe(2)
    expect(json.errorTypes).toEqual(["TimedOut"])
  }, 20_000)
})
