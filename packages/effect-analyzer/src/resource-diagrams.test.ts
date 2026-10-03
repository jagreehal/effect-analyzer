import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { renderPathsMermaid, renderStaticMermaid } from "./output/mermaid"
import { renderRailwayMermaid } from "./output/mermaid-railway"
import { renderTimelineMermaid } from "./output/mermaid-timeline"
import { generatePaths } from "./path-generator"
import { analyzeEffectSource } from "./static-analyzer"
import { isTrivialProgram } from "./trivial-programs"

// A pooled connection acquired, queried, then released whatever happens.
const source = `
  import { Effect, Schema } from 'effect';

  declare const pool: {
    connect: () => Promise<string>;
    query: (c: string) => Promise<number>;
    release: (c: string) => void;
  };

  export class PoolConnectionError extends Schema.TaggedError<PoolConnectionError>()(
    'PoolConnectionError',
    { message: Schema.String },
  ) {}

  export const queryCount = Effect.acquireUseRelease(
    Effect.tryPromise(() => pool.connect()),
    (c) => Effect.promise(() => pool.query(c)),
    (c) => Effect.sync(() => pool.release(c)),
  ).pipe(Effect.withSpan('queryCount'));
`

const analyze = async () => {
  const irs = await Effect.runPromise(analyzeEffectSource(source))
  const ir = irs.find((program) => program.root.programName === "queryCount")
  expect(ir).toBeDefined()
  return { irs, ir: ir! }
}

/** Index of the first line containing each needle; fails if any is missing. */
const order = (text: string, needles: ReadonlyArray<string>) =>
  needles.map((needle) => {
    const index = text.indexOf(needle)
    expect(index, `expected "${needle}" in:\n${text}`).toBeGreaterThanOrEqual(0)
    return index
  })

// A scoped acquireRelease: the release runs when the scope closes, after every
// later step in the generator.
const analyzeScoped = async () => {
  const irs = await Effect.runPromise(analyzeEffectSource(`
    import { Effect } from 'effect';
    declare const pool: {
      connect: () => Promise<string>;
      query: (c: string) => Promise<number>;
      release: (c: string) => void;
    };
    export const scopedCount = Effect.gen(function* () {
      const c = yield* Effect.acquireRelease(
        Effect.tryPromise(() => pool.connect()),
        (c) => Effect.sync(() => pool.release(c)),
      );
      const rows = yield* Effect.tryPromise(() => pool.query(c));
      return rows;
    }).pipe(Effect.scoped);
  `))
  return irs.find((program) => program.root.programName === "scopedCount")!
}

const isAscending = (xs: ReadonlyArray<number>) => xs.every((x, i) => i === 0 || xs[i - 1]! < x)

describe("acquireUseRelease diagrams", () => {
  it("mermaid draws acquire -> use -> release and ends after release", async () => {
    const { ir } = await analyze()
    const out = renderStaticMermaid(ir)
    const idOf = (label: string) => new RegExp(`\\s(\\w+)\\["${label}[^"]*"\\]`).exec(out)?.[1]
    // Steps are named after the call each one wraps.
    const acquire = idOf("pool.connect")
    const use = idOf("pool.query")
    const release = idOf("pool.release")
    expect(acquire && use && release, out).toBeTruthy()
    // No orphan node: every declared node is on an edge.
    const declared = [...out.matchAll(/^\s+(\w+)\[/gm)].map((m) => m[1]!)
    for (const id of declared) expect(out, `orphan ${id}`).toMatch(new RegExp(`(-->|\\|)\\s*${id}\\b|\\b${id}\\s*-->`))
    expect(out).toMatch(new RegExp(`${release}\\s*-->\\s*end_node`))
    expect(out).toMatch(new RegExp(`-->\\|release\\|\\s*${release}`))
  })

  it("timeline lists acquire, use, release in execution order", async () => {
    const { ir } = await analyze()
    const out = renderTimelineMermaid(ir)
    expect(isAscending(order(out, ["Effect.tryPromise", "Effect.promise", "Effect.sync"]))).toBe(true)
  })

  it("paths list acquire, use, release in execution order", async () => {
    const { ir } = await analyze()
    const out = renderPathsMermaid(generatePaths(ir))
    expect(isAscending(order(out, ["Effect.tryPromise", "Effect.promise", "Effect.sync"]))).toBe(true)
  })

  it("railway shows each phase as its own step", async () => {
    const { ir } = await analyze()
    const out = renderRailwayMermaid(ir)
    expect(out).not.toContain("\"Resource\"")
    expect(isAscending(order(out, ["pool.connect", "pool.query", "pool.release"]))).toBe(true)
  })

  it("railway keeps a scoped acquireRelease release out of the step sequence", async () => {
    const out = renderRailwayMermaid(await analyzeScoped())
    expect(isAscending(order(out, ["pool.connect", "pool.query"]))).toBe(true)
    expect(out).not.toContain("pool.release")
  })

  it("mermaid hangs a scoped release off the resource as a deferred edge", async () => {
    const out = renderStaticMermaid(await analyzeScoped())
    const idOf = (label: string) => new RegExp(`\\s(\\w+)\\["[^"]*${label}[^"]*"\\]`).exec(out)?.[1]
    const query = idOf("pool.query")
    const release = idOf("pool.release")
    expect(query && release, out).toBeTruthy()
    // Nothing flows from the release into the query...
    expect(out).not.toMatch(new RegExp(`${release}\\s*-->\\s*${query}\\b`))
    // ...it hangs off the resource as a deferred side edge.
    expect(out).toMatch(new RegExp(`-\\.->\\|on scope close\\|\\s*${release}\\b`))
  })

  it("a lone acquireUseRelease program is not trivial", async () => {
    const { ir } = await analyze()
    expect(isTrivialProgram(ir)).toBe(false)
  })
})

describe("error class declarations", () => {
  it("are not discovered as programs", async () => {
    const irs = await Effect.runPromise(analyzeEffectSource(`
      import { Context, Data, Effect, Schema } from 'effect';
      export class A extends Schema.TaggedError<A>()('A', { message: Schema.String }) {}
      export class B extends Data.TaggedError('B')<{}> {}
      export class C extends Data.Error<{}> {}
      export class Svc extends Context.Service<Svc, { readonly run: Effect.Effect<void> }>()('Svc') {}
      export const program = Effect.gen(function* () {
        const svc = yield* Svc;
        yield* svc.run;
      });
    `))
    const names = irs.map((ir) => ir.root.programName)
    expect(names).toContain("program")
    expect(names).not.toContain("A")
    expect(names).not.toContain("B")
    expect(names).not.toContain("C")
  })
})
