import { Effect } from "effect"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { analyzeProjectCorpus, runCoverageAuditFromCorpus } from "./project-analyzer"
import { scanProjectCorpus } from "./project-corpus"

describe("project corpus", () => {
  it("treats a file root as a one-file project", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-corpus-file-"))
    try {
      const file = join(root, "program.ts")
      writeFileSync(file, "import { Effect } from \"effect\";\nexport const program = Effect.succeed(1);\n")
      const corpus = await Effect.runPromise(scanProjectCorpus(file))
      expect(corpus.files.map((entry) => entry.file)).toEqual([file])
      expect(corpus.files[0]?.status).toBe("ok")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("records one outcome for every discovered file in stable order", async () => {
    const root = mkdtempSync(join(tmpdir(), "effect-corpus-"))
    try {
      writeFileSync(join(root, "z-types.ts"), "export type UserId = string;\n")
      writeFileSync(
        join(root, "a-program.ts"),
        [
          "import { Effect } from \"effect\";",
          "export const program = Effect.succeed(1);"
        ].join("\n")
      )

      const corpus = await Effect.runPromise(scanProjectCorpus(root, {
        includePerFileTiming: true
      }))

      expect(corpus.files.map((entry) => entry.file)).toEqual([
        join(root, "a-program.ts"),
        join(root, "z-types.ts")
      ])
      expect(corpus.files.map((entry) => entry.status)).toEqual(["ok", "zero"])
      expect(corpus.files.every((entry) => typeof entry.durationMs === "number")).toBe(true)

      const [project, audit] = await Promise.all([
        Effect.runPromise(analyzeProjectCorpus(corpus)),
        Effect.runPromise(runCoverageAuditFromCorpus(corpus))
      ])
      expect(project.fileCount).toBe(2)
      expect(project.allPrograms).toHaveLength(1)
      expect(audit.discovered).toBe(2)
      expect(audit.assessment.effectAdoption).toEqual({
        numerator: 1,
        denominator: 2,
        rate: 0.5
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
