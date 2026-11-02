/**
 * A mistyped path prints the mode's own actionable message once, with no
 * restatement and no serialised Effect `Cause`.
 */
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = resolve(__dirname, "..")

const runCli = (args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, [join(repoRoot, "dist/cli.js"), ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  })

describe("cli fatal errors", () => {
  it("reports a missing path once, without internal Effect state", () => {
    const result = runCli(["./no-such-file.ts"])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no-such-file.ts")
    expect(result.stderr).not.toContain("_id")
    expect(result.stderr).not.toContain("Cause")
    expect(result.stderr).not.toContain("_tag")
    // The path is named once. Repeating it is what made the real message hard
    // to find among the restatements.
    expect(result.stderr.match(/Path not found/g)).toHaveLength(1)
  })

  it("rejects an unknown --format instead of quietly using the default", () => {
    const result = runCli([join(repoRoot, "src"), "--format", "nosuchformat"])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("nosuchformat")
    expect(result.stderr).not.toContain("_id")
  })
})
