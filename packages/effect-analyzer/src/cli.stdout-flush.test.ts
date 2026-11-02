/**
 * The CLI exits with `process.exit`, which discards whatever is still queued on
 * a piped stdout, so it waits for stdout to drain first. A large JSON report
 * must arrive whole through a pipe. Only a piped run exercises this, since
 * file writes complete synchronously.
 */

import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "..")

const run = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024
  })

describe("piped stdout", () => {
  it("writes a complete report when stdout is a pipe", () => {
    // The analyzer's own src is far larger than the 64KB pipe buffer.
    const result = run(["src", "--lint-source"])
    expect(result.status).toBe(0)
    expect(result.stdout.length).toBeGreaterThan(200_000)
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow()
  }, 300_000)

  it("writes complete diagnostics when stdout is a pipe", () => {
    const result = run(["diagnostics", "--project", "tsconfig.json", "--format", "json"])
    expect(result.stdout.length).toBeGreaterThan(64 * 1024)
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow()
  }, 300_000)
})
