import { Effect } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildSourceLinesMap } from "./cli-support"

describe("buildSourceLinesMap", () => {
  it("skips unreadable files instead of failing the run", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-analyze-source-lines-"))
    try {
      const readable = join(root, "readable.ts")
      writeFileSync(readable, "const a = 1;\nconst b = 2;\n", "utf8")
      const missing = join(root, "does-not-exist.ts")

      // The unreadable path is listed first: if the skip regressed, the whole
      // effect fails here rather than returning a partial map.
      const map = await Effect.runPromise(buildSourceLinesMap([missing, readable]))

      expect(map.has(missing)).toBe(false)
      expect(map.get(readable)).toEqual(["const a = 1;", "const b = 2;", ""])
      expect(map.size).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("returns an empty map when nothing is readable", async () => {
    const map = await Effect.runPromise(
      buildSourceLinesMap(["/nonexistent/a.ts", "/nonexistent/b.ts"])
    )
    expect(map.size).toBe(0)
  })
})
