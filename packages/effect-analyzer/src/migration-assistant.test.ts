import { describe, expect, it } from "vitest"
import { findMigrationOpportunities } from "./migration-assistant"

// Source whose line numbers are easy to assert against. Line 1 is the first
// line of the template literal (the leading newline), so `const SRC` content
// starts on line 2.
const SRC = `
async function fetchUser(id: string) {
  try {
    const response = await fetch('/api/users/' + id);
    return response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
}
`

describe("migration-assistant: location + snippet accuracy", () => {
  const opps = findMigrationOpportunities("virtual.ts", SRC)

  const byPattern = (p: string) => opps.find((o) => o.pattern === p)

  it("reports the exact line of the try/catch (no off-by-one)", () => {
    const tryCatch = byPattern("try/catch")
    expect(tryCatch).toBeDefined()
    // `try {` is on line 3 of SRC.
    expect(tryCatch!.line).toBe(3)
  })

  it("reports the exact line of the fetch() call", () => {
    const fetchCall = byPattern("fetch()")
    expect(fetchCall).toBeDefined()
    // `await fetch(...)` is on line 4.
    expect(fetchCall!.line).toBe(4)
  })

  it("attributes the snippet to the matched node, not a neighbouring one", () => {
    const tryCatch = byPattern("try/catch")
    expect(tryCatch!.codeSnippet).toMatch(/^try \{/)

    const fetchCall = byPattern("fetch()")
    expect(fetchCall!.codeSnippet).toMatch(/^fetch\(/)

    const thrown = byPattern("throw")
    expect(thrown!.codeSnippet).toMatch(/^throw/)
  })

  it("points every opportunity at a line that actually exists in the source", () => {
    const lineCount = SRC.split("\n").length
    for (const o of opps) {
      expect(o.line).toBeGreaterThanOrEqual(1)
      expect(o.line).toBeLessThanOrEqual(lineCount)
      expect(o.column).toBeGreaterThanOrEqual(1)
    }
  })
})

// Plain async code with retry, timeout, error class, constructor injection and cleanup idioms.
const PATTERN_SRC = `
export class ProviderSoftFail extends Error {
  constructor(readonly status: number) { super("soft"); }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function withTimeoutExecutor<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject);
  });
}

async function callWithRetry(fn: () => Promise<string>, attempts: number) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt));
    }
  }
  throw new Error("exhausted");
}

export class OrderNotifier {
  constructor(private readonly mailer: Mailer) {}
  async notify(email: string) { await this.mailer.send(email); }
}

export async function queryUserCount(pool: Pool): Promise<number> {
  const connection = await pool.connect();
  try {
    return (await connection.query("select 1")).rows.length;
  } finally {
    pool.release(connection);
  }
}
`

describe("migration-assistant: pattern-level detectors", () => {
  const opps = findMigrationOpportunities("before.ts", PATTERN_SRC)
  const patterns = opps.filter((o) => o.kind === "pattern")
  const byPattern = (p: string) => patterns.filter((o) => o.pattern === p)

  it("detects a for-loop retry with try/catch + sleep as Effect.retry + Schedule", () => {
    const [retry, ...rest] = byPattern("retry loop")
    expect(rest).toHaveLength(0)
    expect(retry!.line).toBe(28)
    expect(retry!.effectApi).toEqual(["Effect.retry", "Schedule.exponential"])
    expect(retry!.explanation).toMatch(/Schedule/)
  })

  it("reports a retry loop nested in another loop once", () => {
    const nested = findMigrationOpportunities(
      "nested.ts",
      `async function syncAll(jobs: Array<() => Promise<void>>) {
  for (let i = 0; i < jobs.length; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await jobs[i]!();
        break;
      } catch {
        await sleep(10);
      }
    }
  }
}
`
    ).filter((o) => o.pattern === "retry loop")
    expect(nested.map((o) => o.line)).toEqual([3])
  })

  it("detects Promise.race and new Promise executors with a setTimeout reject as a timeout", () => {
    const timeouts = byPattern("timeout race")
    expect(timeouts.map((o) => o.line)).toEqual([9, 21])
    expect(timeouts[0]!.effectApi).toEqual(["Effect.timeout", "Effect.timeoutOrElse"])
  })

  it("detects `class X extends Error` as Schema.TaggedError", () => {
    const [err] = byPattern("Error subclass")
    expect(err!.line).toBe(2)
    expect(err!.suggestion).toContain("Schema.TaggedError<ProviderSoftFail>()(\"ProviderSoftFail\"")
  })

  it("detects constructor-injected classes as Context.Service + Layer, but not Error subclasses", () => {
    const di = byPattern("constructor-injected class")
    expect(di.map((o) => o.line)).toEqual([38])
    expect(di[0]!.suggestion).toContain("OrderNotifier")
    expect(di[0]!.effectApi).toEqual(["Context.Service", "Layer.effect"])
  })

  it("detects try/finally release as Effect.acquireUseRelease, ignoring timer-only cleanup", () => {
    const releases = byPattern("try/finally release")
    expect(releases.map((o) => o.line)).toEqual([45])
    expect(releases[0]!.effectApi).toEqual(["Effect.acquireUseRelease"])
  })

  it("lists pattern findings first, then the existing syntax findings", () => {
    const firstSyntax = opps.findIndex((o) => o.kind === "syntax")
    expect(firstSyntax).toBe(patterns.length)
    expect(opps.slice(firstSyntax).some((o) => o.pattern === "try/catch")).toBe(true)
  })
})
