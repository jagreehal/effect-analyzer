/**
 * Drives the built server over stdio, the way an editor does.
 */
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const REPO_ROOT = resolve(__dirname, "..", "..")

const UNYIELDED = `import { Effect } from "effect"

export const program = Effect.gen(function*() {
  Effect.succeed(1)
  yield Effect.logInfo("synced")
})
`
const FIXED = UNYIELDED.replace("  Effect.succeed", "  yield* Effect.succeed").replace("yield Effect", "yield* Effect")

interface Message {
  readonly id?: number
  readonly method?: string
  readonly params?: {
    readonly diagnostics?: ReadonlyArray<{
      code?: string
      source?: string
      range: { start: { line: number; character: number } }
    }>
  }
  readonly result?: unknown
  readonly error?: { readonly message: string }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

class Client {
  readonly messages: Array<Message> = []
  stderr = ""
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly child: ChildProcessWithoutNullStreams

  constructor() {
    this.child = spawn(process.execPath, [join(REPO_ROOT, "dist/lsp/server.js"), "--stdio"], { cwd: REPO_ROOT })
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString()
    })
    // The assertion that follows reports a closed stdin.
    this.child.stdin.on("error", () => {})
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      for (;;) {
        const header = this.buffer.indexOf("\r\n\r\n")
        if (header < 0) return
        const length = Number(/Content-Length: (\d+)/.exec(this.buffer.subarray(0, header).toString())?.[1])
        if (this.buffer.length < header + 4 + length) return
        this.messages.push(JSON.parse(this.buffer.subarray(header + 4, header + 4 + length).toString()) as Message)
        this.buffer = this.buffer.subarray(header + 4 + length)
      }
    })
  }

  private send(message: object): void {
    const body = JSON.stringify({ jsonrpc: "2.0", ...message })
    this.child.stdin.write(`Content-Length: ${String(Buffer.byteLength(body))}\r\n\r\n${body}`)
  }

  notify(method: string, params: object): void {
    this.send({ method, params })
  }

  async request(method: string, params: object): Promise<Message> {
    const id = this.nextId++
    this.send({ id, method, params })
    return await this.until((messages) => messages.find((m) => m.id === id))
  }

  async until<A>(find: (messages: ReadonlyArray<Message>) => A | undefined, ms = 30_000): Promise<A> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      const found = find(this.messages)
      if (found !== undefined) return found
      await sleep(25)
    }
    throw new Error(`timed out; stderr: ${this.stderr}`)
  }

  /** Language service rules in the newest publish at or after message `from`. */
  rules(from: number): ReadonlyArray<string | undefined> | undefined {
    const published = this.messages.slice(from).filter((m) => m.method === "textDocument/publishDiagnostics")
    return published.at(-1)?.params?.diagnostics?.filter((d) => d.source === "effect").map((d) => d.code)
  }

  /** Pids of every process below the server. */
  descendants(): ReadonlyArray<number> {
    const rows = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((row) => row.trim().split(/\s+/).map(Number))
    const below = (pid: number | undefined): ReadonlyArray<number> =>
      rows.filter(([, ppid]) => ppid === pid).flatMap(([child]) => child === undefined ? [] : [child, ...below(child)])
    return below(this.child.pid)
  }

  stop(): void {
    this.child.kill()
  }
}

describe("lsp server", () => {
  let root = ""
  let file = ""
  let client: Client

  const open = async (text: string, plugins?: ReadonlyArray<object>) => {
    writeFileSync(file, text, "utf8")
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          ...(plugins ? { plugins } : {})
        },
        include: ["src/**/*.ts"]
      }),
      "utf8"
    )
    await client.request("initialize", { processId: null, rootUri: null, capabilities: {} })
    client.notify("initialized", {})
    client.notify("textDocument/didOpen", {
      textDocument: { uri: uri(), languageId: "typescript", version: 1, text }
    })
  }
  const uri = () => pathToFileURL(file).href
  const replaceText = (version: number, text: string) => {
    client.notify("textDocument/didChange", { textDocument: { uri: uri(), version }, contentChanges: [{ text }] })
  }
  const published = (from: number, expected: ReadonlyArray<string>) =>
    client.until(() => (JSON.stringify(client.rules(from)) === JSON.stringify(expected) ? true : undefined))

  beforeEach(() => {
    root = mkdtempSync(join(REPO_ROOT, ".tmp-tsgo-lsp-"))
    mkdirSync(join(root, "src"))
    file = join(root, "src", "program.ts")
    client = new Client()
  })

  afterEach(() => {
    client.stop()
    rmSync(root, { recursive: true, force: true })
  })

  it("starts and answers the requests it advertises", async () => {
    await open(FIXED)
    const textDocument = { uri: uri() }
    const position = { line: 3, character: 4 }
    const range = { start: { line: 0, character: 0 }, end: { line: 6, character: 0 } }
    for (
      const [method, params] of [
        ["textDocument/inlayHint", { textDocument, range }],
        ["textDocument/selectionRange", { textDocument, positions: [position] }],
        ["textDocument/documentLink", { textDocument }],
        ["textDocument/hover", { textDocument, position }],
        ["textDocument/documentSymbol", { textDocument }]
      ] as const
    ) {
      const response = await client.request(method, params)
      expect(response.error, method).toBeUndefined()
    }
    expect(client.stderr).toBe("")
  })

  it("reports Effects that never run on open and save, and drops them on edit", async () => {
    await open(UNYIELDED)
    await published(0, ["floatingEffect", "missingStarInYieldEffectGen"])
    const last = client.messages.findLast((m) => m.method === "textDocument/publishDiagnostics")
    expect(last?.params?.diagnostics?.find((d) => d.code === "floatingEffect")?.range.start).toEqual({
      line: 3,
      character: 2
    })

    // Unsaved edits: the findings no longer describe this text.
    const edited = client.messages.length
    replaceText(2, `\n${UNYIELDED}`)
    await published(edited, [])

    const saved = client.messages.length
    writeFileSync(file, `\n${UNYIELDED}`, "utf8")
    client.notify("textDocument/didSave", { textDocument: { uri: uri() } })
    await published(saved, ["floatingEffect", "missingStarInYieldEffectGen"])

    const closed = client.messages.length
    client.notify("textDocument/didClose", { textDocument: { uri: uri() } })
    await published(closed, [])
  })

  it.skipIf(process.platform === "win32").each(["didClose", "server exit"])(
    "stops the compiler it started on %s",
    async (how) => {
      await open(UNYIELDED)
      // server → cli → effect-tsgo → native compiler
      const { compiler, tree } = await client.until(() => {
        const found = client.descendants()
        const last = found.at(-1)
        if (found.length < 3 || last === undefined) return undefined
        try {
          // Frozen, the compiler cannot end by itself and pass for cancelled.
          process.kill(last, "SIGSTOP")
          return { compiler: last, tree: found }
        } catch {
          // It has ended; another run of it follows.
          return undefined
        }
      })
      try {
        if (how === "didClose") client.notify("textDocument/didClose", { textDocument: { uri: uri() } })
        else client.stop()
        await client.until(() => (tree.some((pid) => isAlive(pid)) ? undefined : true), 10_000)
      } finally {
        if (isAlive(compiler)) process.kill(compiler, "SIGKILL")
      }
    }
  )

  it("leaves them to the editor when the project configures the language service", async () => {
    await open(UNYIELDED, [{ name: "@effect/language-service" }])
    await client.until(() => (client.rules(0) === undefined ? undefined : true))
    // Longer than an unconfigured run takes to report.
    await sleep(5_000)
    expect(client.rules(0)).toEqual([])
  })
})
