import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { renderExplanation } from "./output/explain"
import { renderEnhancedMermaid, renderStaticMermaid } from "./output/mermaid"
import { renderRailwayMermaid } from "./output/mermaid-railway"
import { analyzeEffectSource } from "./static-analyzer"

const SOURCE = `import { Effect } from "effect"
export const program = Effect.gen(function*() {
  yield Effect.logInfo("synced")
})
`

describe("a yield missing its star", () => {
  it("is named in every view instead of drawn as an opaque step", async () => {
    const [ir] = await Effect.runPromise(analyzeEffectSource(SOURCE, "program.ts"))
    if (!ir) throw new Error("no program found")
    for (
      const rendered of [
        renderRailwayMermaid(ir),
        renderStaticMermaid(ir),
        renderEnhancedMermaid(ir),
        renderExplanation(ir)
      ]
    ) {
      expect(rendered).toMatch(/yield without \*: Effect\.logInfo/)
      expect(rendered).not.toContain("plain-yield")
    }
  })
})
