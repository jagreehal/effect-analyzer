import { Effect } from "effect"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { analyze } from "./analysis-entry"
import { toAsciiText } from "./analysis-utils"
import { renderExplanation } from "./output/explain"
import { renderRailwayMermaid } from "./output/mermaid-railway"
import { analyzeEffectSource } from "./static-analyzer"
import type { StaticEffectIR } from "./types"

// Real file so the checker resolves `effect` (requirements come from types).
const fixture = resolve(__dirname, "__fixtures__/explain-shapes.ts")
const program = (name: string): Promise<StaticEffectIR> => Effect.runPromise(analyze(fixture).named(name))

describe("explain shapes", { timeout: 30_000 }, () => {
  it("prints the program's full type signature", async () => {
    const explained = renderExplanation(await program("pay"))
    expect(explained).toMatch(/Type: Effect<\{ paymentId: string; \}, StoreError, (Store \| Gateway|Gateway \| Store)>/)
  })

  it("lists services a yielded sub-program requires", async () => {
    const explained = renderExplanation(await program("pay"))
    expect(explained).toContain("Services required: Store, Gateway")
  })

  it("keeps a plain-value early return and labels its decision", async () => {
    const ir = await program("pay")
    const explained = renderExplanation(ir)
    expect(explained).toMatch(/If existing:\n\s+Returns \{ paymentId: existing\.id \}/)
    const railway = renderRailwayMermaid(ir)
    expect(railway).toContain(`["existing"]`)
    expect(railway).not.toContain(`"decision"`)
    expect(railway).toMatch(/-\.->\|early return\| Done/)
  })

  it("adds no decision for a branch whose only exit is a bare return", async () => {
    const [ir] = await Effect.runPromise(analyzeEffectSource(`
      import { Effect } from 'effect';
      declare const ready: boolean;
      export const run = Effect.gen(function* () {
        if (!ready) return;
        yield* Effect.log('go');
      });
    `))
    expect(renderExplanation(ir!)).not.toContain("If ")
  })

  it("names the promise call inside tryPromise", async () => {
    const ir = await program("transfer")
    const explained = renderExplanation(ir)
    expect(explained).toContain("balance <- wallet.getBalance")
    expect(explained).toContain("wallet.debit")
    expect(explained).not.toContain("tryPromise —")
    const railway = renderRailwayMermaid(ir)
    expect(railway).toContain(`["wallet.getBalance"]`)
    expect(railway).toContain(`["wallet.debit"]`)
  })

  it("labels an onError cleanup that restores state with the field it sets", async () => {
    const ir = await program("persistWithRollback")
    expect(renderRailwayMermaid(ir)).toContain(`["set ledger.balance"]`)
    expect(renderExplanation(ir)).toContain("Sets ledger.balance via sync")
  })

  it("labels an onError cleanup with the call its Effect.sync wraps", async () => {
    expect(renderRailwayMermaid(await program("debitWithAudit"))).toContain(`["wallet.audit"]`)
  })

  it("names a lone call statement inside a block-bodied Effect.sync", async () => {
    const railway = renderRailwayMermaid(await program("transfer"))
    expect(railway).toContain(`["wallet.audit"]`)
  })
})

describe("toAsciiText", () => {
  it("replaces typographic symbols with ASCII", () => {
    expect(toAsciiText("Calls a — b → c ← d … ⚠ x – y ⇒ z")).toBe("Calls a - b -> c <- d ... ! x - y => z")
  })
})
