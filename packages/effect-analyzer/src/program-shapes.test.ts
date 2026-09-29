import { Effect } from "effect"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { analyze } from "./analysis-entry"
import { renderExplanation } from "./output/explain"
import { renderConcurrencyMermaid } from "./output/mermaid-concurrency"
import { isTrivialProgram } from "./trivial-programs"
import type { StaticEffectIR } from "./types"

// Real file so the checker resolves `effect` (error channels come from types).
const fixture = resolve(__dirname, "__fixtures__/program-shapes.ts")
const program = (name: string): Promise<StaticEffectIR> => Effect.runPromise(analyze(fixture).named(name))

describe("program shapes", { timeout: 30_000 }, () => {
  it("recognises yield* new SubclassOfTaggedError as a failure", async () => {
    const ir = await program("fetchPage")
    expect(JSON.stringify(ir.root)).not.toContain("Unrecognized constructor")
    expect(ir.root.errorTypes).toEqual(["PageSkipped", "PageUnavailable"])
  })

  it("error paths reflect what handlers catch and re-raise", async () => {
    expect((await program("load")).root.errorTypes).toEqual(["LoadFailed"])
    expect((await program("resync")).root.errorTypes).toEqual([])
    expect((await program("resyncGen")).root.errorTypes).toEqual([])
  })

  it("reads concurrency from a const on Effect.forEach", async () => {
    const ir = await program("resync")
    const explained = renderExplanation(ir)
    expect(explained).toContain("(concurrency: 4)")
    expect(explained).toContain("Concurrency: uses parallelism")
    expect(renderConcurrencyMermaid(ir)).toContain("concurrency: 4")
  })

  it("keeps the Stream main program with both merge branches and its sink", async () => {
    const ir = await program("main")
    expect(isTrivialProgram(ir)).toBe(false)
    const explained = renderExplanation(ir)
    expect(explained).toContain("Stream: make -> debounce -> merge -> mapEffect -> runDrain\n")
    expect(explained).toContain("merge branch:")
    expect(explained).toContain("Stream: tick -> map")
    expect(explained).not.toContain("unknown")
    expect(ir.root.errorTypes).toEqual(["LoadFailed"])
  })

  it("analyzes each catchTags handler instead of the object literal", async () => {
    const explained = renderExplanation(await program("load"))
    expect(explained).not.toContain("Non-Effect object literal")
    expect(explained).toContain("(the piped effect)")
    expect(explained).toContain("Handler (PageSkipped):")
    expect(explained).toContain("Handler (PageUnavailable):")
  })

  it("reads the source and method-syntax handlers of data-first catchTags", async () => {
    const ir = await program("loadOrDefault")
    const explained = renderExplanation(ir)
    expect(explained).not.toContain("unknown")
    expect(explained).not.toContain("Calls Effect\n")
    expect(explained).toMatch(/Catches tags \[PageSkipped, PageUnavailable\] on:\n\s+Calls fetchPage/)
    expect(explained).toMatch(/Handler \(PageSkipped\):\n\s+Calls succeed/)
    expect(explained).toMatch(/Handler \(PageUnavailable\):\n\s+Pipes log/)
    expect(ir.root.errorTypes).toEqual([])
  })

  it("reads concurrency from expressions, string consts and a bound of one", async () => {
    expect(renderExplanation(await program("scaledLoop"))).toContain("(concurrency: bounded)")
    expect(renderExplanation(await program("unboundedLoop"))).toContain("(concurrency: unbounded)")
    const one = renderExplanation(await program("oneAtATime"))
    expect(one).not.toContain("(concurrency:")
    expect(one).toContain("Concurrency: sequential")
    const all = renderExplanation(await program("bothPages"))
    expect(all).toContain("in parallel (concurrency: 2)")
  })

  it("quotes loop labels in the concurrency diagram", async () => {
    const diagram = renderConcurrencyMermaid(await program("arrayLoop"))
    expect(diagram).toMatch(/L0\[\["forEach.*concurrency: 4.*"\]\]/)
  })

  it("reads the tag of data-first catchTag", async () => {
    const ir = await program("skippedOnly")
    expect(renderExplanation(ir)).toContain("Catches tag \"PageSkipped\" on:")
    expect(ir.root.errorTypes).toEqual(["PageUnavailable"])
  })

  it("keeps a data-last merge branch next to options, and unary zips unchanged", async () => {
    const merged = renderExplanation(await program("mergeWithOptions"))
    expect(merged).toContain("Stream: make -> merge -> runDrain")
    expect(merged).toContain("merge branch:")
    const indexed = renderExplanation(await program("indexed"))
    expect(indexed).toContain("Stream: make -> zipWithIndex")
    expect(indexed).not.toContain("branch")
  })

  it("shows the outer handler of a piped generator", async () => {
    const explained = renderExplanation(await program("resyncGen"))
    expect(explained).toContain("Catches all errors on:")
  })
})
