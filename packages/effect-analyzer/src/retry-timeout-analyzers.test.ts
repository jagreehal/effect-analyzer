import { Effect } from "effect"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { analyze } from "./analysis-entry"
import { renderExplanation } from "./output/explain"
import { renderConcurrencyMermaid } from "./output/mermaid-concurrency"
import { renderRetryMermaid } from "./output/mermaid-retry"
import type { StaticEffectIR } from "./types"

const fixture = resolve(__dirname, "__fixtures__/retry-timeout-options.ts")
const program = (name: string): Promise<StaticEffectIR> => Effect.runPromise(analyze(fixture).named(name))

describe("retry / timeout options", { timeout: 30_000 }, () => {
  it("resolves a retry options object and its schedule const", async () => {
    const explained = renderExplanation(await program("charge"))
    expect(explained).toContain("Retries (max 2, exponential, jittered, while predicate):")
    expect(explained).not.toContain("custom")
    expect(explained).not.toContain("Calls Effect\n")
  })

  it("resolves a shorthand schedule property to its bound value", async () => {
    const explained = renderExplanation(await program("chargeShorthand"))
    expect(explained).toContain("Retries (max 3, exponential")
    expect(explained).not.toContain("custom")
  })

  it("reads times from retry options", async () => {
    expect(renderExplanation(await program("chargeTimes"))).toContain("Retries (max 3")
  })

  it("resolves the schedule const on a pipe after Effect.gen", async () => {
    expect(renderExplanation(await program("chargeGen"))).toContain("Retries (max 2, exponential, jittered):")
  })

  it("extracts the duration from timeoutOrElse options", async () => {
    const ir = await program("callOnce")
    const explained = renderExplanation(ir)
    expect(explained).toContain("Times out after Duration.millis(timeoutMs):")
    expect(explained).toContain("(with fallback on timeout)")
    const diagram = renderRetryMermaid(ir)
    expect(diagram).toContain("timeout: Duration.millis#lpar;timeoutMs#rpar;]")
    expect(diagram).not.toContain("orElse")
  })

  it("labels the retry diagram from the resolved schedule", async () => {
    expect(renderRetryMermaid(await program("charge"))).toContain("exponential 2x 10ms +jitter")
  })
})

describe("forEach concurrency shorthand", { timeout: 30_000 }, () => {
  it("reads { concurrency } from a parameter binding", async () => {
    const ir = await program("enrichAll")
    const explained = renderExplanation(ir)
    expect(explained).toContain("(concurrency: bounded)")
    expect(explained).toContain("Concurrency: uses parallelism")
    expect(renderConcurrencyMermaid(ir)).not.toContain("NoConcurrency")
  })
})
