/**
 * Migration Assistant (GAP 29)
 *
 * Detects patterns that could be migrated to Effect (try/catch, Promise.all, etc.).
 */

import { readdir } from "node:fs/promises"
import { extname, join } from "path"
import { Node, Project, SyntaxKind } from "ts-morph"
import type { SourceFile } from "ts-morph"

// =============================================================================
// Types
// =============================================================================

export interface MigrationOpportunity {
  readonly filePath: string
  readonly line: number
  readonly column: number
  readonly pattern: string
  readonly suggestion: string
  readonly codeSnippet?: string | undefined
  /**
   * `pattern`: a multi-statement idiom (retry loop, timeout race, resource
   * release, ...) with a direct Effect replacement. `syntax`: a single
   * construct. Pattern findings are listed first.
   */
  readonly kind?: "pattern" | "syntax" | undefined
  /** Effect APIs the pattern maps to, e.g. `["Effect.retry", "Schedule.exponential"]`. */
  readonly effectApi?: ReadonlyArray<string> | undefined
  /** One or two sentences on why the Effect version is better. */
  readonly explanation?: string | undefined
}

export interface MigrationReport {
  readonly opportunities: ReadonlyArray<MigrationOpportunity>
  readonly fileCount: number
}

// =============================================================================
// Detection
// =============================================================================

function addOpportunity(
  list: Array<MigrationOpportunity>,
  filePath: string,
  node: {
    getStart: () => number
    getStartLineNumber: () => number
    getStartLinePos: () => number
    getText: () => string
  },
  _sourceFile: unknown,
  pattern: string,
  suggestion: string,
  snippet?: string
): void {
  // Use node-relative ts-morph APIs rather than offset math against
  // sourceFile.getText(). The raw character offset from node.getStart() is not
  // consistent with sourceFile.getText() slicing (it produced misattributed
  // snippets and off-by-one lines), so derive everything from the node itself.
  const line = node.getStartLineNumber()
  const column = node.getStart() - node.getStartLinePos() + 1
  const defaultSnippet = node.getText().slice(0, 80).replace(/\s+/g, " ").trim()
  list.push({
    filePath,
    line,
    column,
    pattern,
    suggestion,
    codeSnippet: snippet ?? defaultSnippet,
    kind: "syntax"
  })
}

// =============================================================================
// Pattern-level detection
// =============================================================================

const TIMER_CLEANUP = new Set(["clearTimeout", "clearInterval"])
const SLEEP_NAMES = /^(sleep|delay|wait|backoff)$/i
const LOOP_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement
])

function calleeName(call: Node): string {
  return Node.isCallExpression(call) ? call.getExpression().getText() : ""
}

/** `setTimeout(...)` / `sleep(...)` anywhere under `node`. */
function containsSleep(node: Node): boolean {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => {
    const name = calleeName(c)
    return name === "setTimeout" || SLEEP_NAMES.test(name.split(".").pop() ?? "")
  })
}

/** `setTimeout(() => reject(...), ms)` anywhere under `node`. */
function containsTimeoutReject(node: Node): boolean {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) =>
    calleeName(c) === "setTimeout" &&
    c.getDescendantsOfKind(SyntaxKind.CallExpression).some((inner) => calleeName(inner) === "reject")
  )
}

function isErrorSubclass(cls: Node): boolean {
  if (!Node.isClassDeclaration(cls)) return false
  const base = cls.getExtends()?.getExpression().getText()
  return base !== undefined && /^(Error|TypeError|RangeError)$/.test(base)
}

const PRIMITIVE_TYPES = new Set(["string", "number", "boolean", "bigint", "unknown", "any"])

function findPatternOpportunities(filePath: string, sourceFile: SourceFile): Array<MigrationOpportunity> {
  const found: Array<MigrationOpportunity> = []
  const add = (
    node: Node,
    pattern: string,
    suggestion: string,
    effectApi: ReadonlyArray<string>,
    explanation: string
  ) => {
    const before = found.length
    addOpportunity(found, filePath, node, sourceFile, pattern, suggestion)
    found[before] = { ...found[before]!, kind: "pattern", effectApi, explanation }
  }

  // (a) for/while loop + try/catch + sleep -> Effect.retry + Schedule
  const loops = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.ForStatement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.WhileStatement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.DoStatement)
  ]
  for (const loop of loops) {
    // Only a try whose nearest loop is this one, so an outer loop around a
    // retry loop is not reported again.
    const tries = loop.getStatement().getDescendantsOfKind(SyntaxKind.TryStatement).filter((t) =>
      t.getCatchClause() !== undefined && t.getFirstAncestor((a) => LOOP_KINDS.has(a.getKind())) === loop
    )
    if (tries.length > 0 && containsSleep(loop.getStatement())) {
      add(
        loop,
        "retry loop",
        "Effect.retry(effect, { schedule: Schedule.exponential(\"10 millis\"), times: n, while: isRetryable })",
        ["Effect.retry", "Schedule.exponential"],
        "A hand-rolled attempt counter, catch and sleep becomes a declarative Schedule: the backoff, attempt cap and retryable-error predicate are data, and the sleep is interruptible."
      )
    }
  }

  // (b) Promise.race / new Promise executor with setTimeout(() => reject()) -> Effect.timeout
  const timeoutApi = ["Effect.timeout", "Effect.timeoutOrElse"]
  const timeoutExplanation =
    "Racing against a setTimeout reject leaks the timer and leaves the losing promise running. Effect.timeout interrupts the slow effect and fails with a typed error (or Effect.timeoutOrElse maps it to your own)."
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (calleeName(call) === "Promise.race" && containsTimeoutReject(call)) {
      add(
        call,
        "timeout race",
        "Effect.timeoutOrElse(effect, { duration: Duration.millis(ms), orElse: () => Effect.fail(new TimedOut()) })",
        timeoutApi,
        timeoutExplanation
      )
    }
  }
  for (const expr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const insideRace = expr.getAncestors().some((a) => calleeName(a) === "Promise.race")
    if (expr.getExpression().getText() === "Promise" && !insideRace && containsTimeoutReject(expr)) {
      add(
        expr,
        "timeout race",
        "Effect.timeoutOrElse(effect, { duration: Duration.millis(ms), orElse: () => Effect.fail(new TimedOut()) })",
        timeoutApi,
        timeoutExplanation
      )
    }
  }

  for (const cls of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const name = cls.getName() ?? "AnonymousError"
    // (c) class X extends Error -> Schema.TaggedError
    if (isErrorSubclass(cls)) {
      add(
        cls,
        "Error subclass",
        `class ${name} extends Schema.TaggedError<${name}>()("${name}", { ...fields })`,
        ["Schema.TaggedError"],
        "A tagged error carries a `_tag` the compiler tracks in the E channel, so callers handle it with Effect.catchTag instead of instanceof checks, and its fields are a Schema."
      )
      continue
    }
    // (d) constructor-injected dependencies -> Context.Service + Layer
    const deps = cls.getConstructors()[0]?.getParameters().filter((p) => {
      const type = p.getTypeNode()?.getText()
      return type !== undefined && !PRIMITIVE_TYPES.has(type)
    }) ?? []
    if (deps.length > 0) {
      add(
        cls,
        "constructor-injected class",
        `class ${name} extends Context.Service<${name}, Shape>()("${name}") {} + Layer.effect(${name}, Effect.gen(...yield* ${
          deps.map((d) => d.getTypeNode()!.getText()).join(", yield* ")
        }))`,
        ["Context.Service", "Layer.effect"],
        "Constructor injection becomes a service tag plus a Layer: dependencies show up in the R channel, and tests swap a Layer instead of hand-building the object graph."
      )
    }
  }

  // (e) try/finally that releases something -> Effect.acquireUseRelease
  for (const tryStmt of sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    const fin = tryStmt.getFinallyBlock()
    if (!fin) continue
    const calls = fin.getDescendantsOfKind(SyntaxKind.CallExpression).map(calleeName)
    if (calls.some((c) => !TIMER_CLEANUP.has(c))) {
      add(
        tryStmt,
        "try/finally release",
        "Effect.acquireUseRelease(acquire, (resource) => use(resource), (resource) => release(resource))",
        ["Effect.acquireUseRelease"],
        "The release runs on success, failure and interruption, and acquire/use/release are separate steps, so the cleanup cannot be skipped by an early return or forgotten in a new branch."
      )
    }
  }

  return found.sort((a, b) => a.line - b.line || a.column - b.column)
}

/**
 * Scan a file for migration opportunities.
 */
export function findMigrationOpportunities(
  filePath: string,
  source?: string
): Array<MigrationOpportunity> {
  const opportunities: Array<MigrationOpportunity> = []
  const project = new Project({ skipAddingFilesFromTsConfig: true })
  const sourceFile = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath)

  const patterns = findPatternOpportunities(filePath, sourceFile)

  // try/catch -> Effect.try / Effect.tryPromise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.TryStatement)) {
    addOpportunity(
      opportunities,
      filePath,
      node,
      sourceFile,
      "try/catch",
      "Effect.try or Effect.tryPromise with catch handler"
    )
  }

  // Promise.all -> Effect.all
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "Promise.all" || (text.endsWith(".all") && text.includes("Promise"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.all",
        "Effect.all([...], { concurrency: \"unbounded\" })"
      )
    }
    if (text === "Promise.race" || (text.endsWith(".race") && text.includes("Promise"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.race",
        "Effect.race(first, second)"
      )
    }
  }

  // setTimeout / setInterval / setImmediate -> Effect.sleep / Schedule
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "setTimeout" || text === "setInterval") {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        text === "setTimeout" ? "Effect.sleep(Duration.millis(n))" : "Schedule.spaced(Duration.millis(n))"
      )
    }
    if (text === "setImmediate" || text === "process.setImmediate") {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "setImmediate",
        "Effect.sync + queueMicrotask or Effect.callback"
      )
    }
  }

  // XMLHttpRequest -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "XMLHttpRequest" || text.includes("XMLHttpRequest")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new XMLHttpRequest()",
        "effect/http HttpClient"
      )
    }
  }

  // Worker / worker_threads -> Effect Worker
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "Worker" || text.includes("Worker")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new Worker()",
        "effect/workers Worker"
      )
    }
  }

  // fs.exists (callback) -> Effect.promise (only fs module, not Option.exists / Exit.exists)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsExists = text === "fs.exists" ||
      (text.endsWith(".exists") && text.startsWith("fs."))
    if (isFsExists && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.exists (callback)",
        "Effect.promise or fs.promises.access"
      )
    }
  }

  // http.request / https.request (callback) -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.endsWith(".request") && (text.includes("http") || text.includes("https"))) ||
      (text === "request" && sourceFile.getText().includes("http"))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "http.request / https.request",
        "effect/http HttpClient"
      )
    }
  }

  // dns.lookup, dns.resolve (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.startsWith("dns.") || text.includes("dns.")) &&
      (text.includes("lookup") || text.includes("resolve") || text.includes("reverse"))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "dns (callback)",
        "Effect.promise or dns.promises"
      )
    }
  }

  // fetch( -> HttpClient
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "fetch") {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fetch()",
        "effect/http HttpClient"
      )
    }
  }

  // EventEmitter -> PubSub
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "EventEmitter" || text.includes("EventEmitter")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new EventEmitter()",
        "PubSub.bounded<EventType>() or PubSub.unbounded<EventType>()"
      )
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.endsWith(".on(") || text.endsWith(".addListener(")) &&
      (text.includes("Emitter") || text.includes("emitter"))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "EventEmitter.on / addListener",
        "PubSub.subscribe for PubSub"
      )
    }
    if (text.endsWith(".emit(") && (text.includes("Emitter") || text.includes("emitter"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "EventEmitter.emit",
        "PubSub.publish for PubSub"
      )
    }
  }

  // class-based DI -> Context.Service + Layer
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const name = node.getName()
    const text = node.getText()
    if (
      name &&
      (text.includes("new ") || text.includes("constructor")) &&
      (name.endsWith("Service") || name.endsWith("Repository") || name.endsWith("Client"))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `class ${name} (manual DI)`,
        `Context.Service<${name}, Shape>()('${name}') + Layer.effect or Layer.succeed`
      )
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.endsWith("Service") || text.endsWith("Repository") || text.endsWith("Client")) &&
      !text.includes("Context") &&
      !text.includes("Layer")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `new ${text}()`,
        `Context.Service + Layer.effect for dependency injection`
      )
    }
  }

  // async/await -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    if (node.getModifiers().some((m) => m.getText() === "async") || node.getText().startsWith("async")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "async function",
        "Effect.gen or Effect.pipe with flatMap"
      )
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)) {
    if (node.getText().startsWith("async")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "async arrow function",
        "Effect.gen or Effect.pipe with flatMap"
      )
    }
  }

  // Promise.then chains -> Effect.flatMap
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text.endsWith(".then") && text.includes("Promise")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.then",
        "Effect.flatMap for sequential composition"
      )
    }
    if (text === "Promise.allSettled" || (text.endsWith(".allSettled") && text.includes("Promise"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.allSettled",
        "Effect.all with merge or separate error handling"
      )
    }
    if (text.endsWith(".catch") && (text.includes("Promise") || text.includes(".then"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.catch",
        "Effect.catch or Effect.catchTag for typed error handling"
      )
    }
    if (text.endsWith(".finally") && (text.includes("Promise") || text.includes(".then"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "Promise.finally",
        "Effect.ensuring for cleanup"
      )
    }
  }

  // addEventListener -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "addEventListener" || text.endsWith(".addEventListener")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "addEventListener",
        "Effect.callback or EventTarget + Effect.asyncInterrupt"
      )
    }
  }

  // fs.readFile / fs.writeFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsCallback =
      (text === "fs.readFile" || text === "fs.writeFile" || text === "readFile" || text === "writeFile") ||
      (text.endsWith(".readFile") && text.startsWith("fs.")) ||
      (text.endsWith(".writeFile") && text.startsWith("fs."))
    if (isFsCallback && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text.includes("write") ? "fs.writeFile (callback)" : "fs.readFile (callback)",
        "Effect.promise or fs.promises + Effect.tryPromise"
      )
    }
  }

  // throw new Error -> Effect.fail
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    addOpportunity(
      opportunities,
      filePath,
      node,
      sourceFile,
      "throw",
      "Effect.fail(error) for typed error channel"
    )
  }

  // util.promisify -> Effect.tryPromise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "promisify" || text.endsWith(".promisify")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "util.promisify",
        "Effect.tryPromise or Effect.callback for callback-style APIs"
      )
    }
  }

  // new Promise -> Effect.callback or Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "Promise") {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new Promise(...)",
        "Effect.callback or Effect.promise for callback-style"
      )
    }
  }

  // for await -> Stream.iterate or Effect.asyncIterable
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
    if (node.getAwaitKeyword()) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "for await...of",
        "Stream.iterate or Effect.asyncIterable for async iteration"
      )
    }
  }

  // sync fs (readFileSync, writeFileSync) -> Effect.promise + fs/promises
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      text === "readFileSync" ||
      text === "writeFileSync" ||
      text === "existsSync" ||
      text.endsWith(".readFileSync") ||
      text.endsWith(".writeFileSync") ||
      text.endsWith(".existsSync")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        "Effect.promise or fs/promises + Effect.tryPromise"
      )
    }
  }

  // process.nextTick -> Effect.sync + queueMicrotask or Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "process.nextTick" || (text.endsWith(".nextTick") && text.includes("process"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "process.nextTick",
        "Effect.sync + queueMicrotask or Effect.callback"
      )
    }
  }

  // queueMicrotask -> Effect.sync
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "queueMicrotask" || text.endsWith(".queueMicrotask")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "queueMicrotask",
        "Effect.sync for deferred execution"
      )
    }
  }

  // WebSocket -> effect/socket
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "WebSocket" || text.includes("WebSocket")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new WebSocket()",
        "effect/socket WebSocket"
      )
    }
  }

  // MessageChannel -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "MessageChannel" || text.includes("MessageChannel")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new MessageChannel()",
        "Effect.callback or Queue for cross-context messaging"
      )
    }
  }

  // fs.appendFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsAppend = text === "fs.appendFile" ||
      (text.endsWith(".appendFile") && text.startsWith("fs."))
    if (isFsAppend && node.getArguments().length >= 2) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.appendFile (callback)",
        "Effect.promise or fs.promises.appendFile"
      )
    }
  }

  // fs.mkdir / fs.stat / fs.unlink (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsCallback = (text === "fs.mkdir" || text === "fs.stat" || text === "fs.unlink" ||
      (text.endsWith(".mkdir") && text.startsWith("fs.")) ||
      (text.endsWith(".stat") && text.startsWith("fs.")) ||
      (text.endsWith(".unlink") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    if (isFsCallback) {
      const name = text.includes("mkdir") ? "fs.mkdir" : text.includes("stat") ? "fs.stat" : "fs.unlink"
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `${name} (callback)`,
        "Effect.promise or fs.promises"
      )
    }
  }

  // MutationObserver -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "MutationObserver" || text.includes("MutationObserver")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new MutationObserver()",
        "Effect.callback or Effect.asyncInterrupt for DOM observation"
      )
    }
  }

  // requestIdleCallback -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "requestIdleCallback" || text.endsWith(".requestIdleCallback")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "requestIdleCallback",
        "Effect.callback or Effect.sync for idle-time work"
      )
    }
  }

  // BroadcastChannel -> PubSub / Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "BroadcastChannel" || text.includes("BroadcastChannel")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new BroadcastChannel()",
        "PubSub or Effect.callback for cross-tab messaging"
      )
    }
  }

  // fs.rename / fs.realpath (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsCallback = (text === "fs.rename" || text === "fs.realpath" ||
      (text.endsWith(".rename") && text.startsWith("fs.")) ||
      (text.endsWith(".realpath") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    if (isFsCallback) {
      const name = text.includes("realpath") ? "fs.realpath" : "fs.rename"
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `${name} (callback)`,
        "Effect.promise or fs.promises"
      )
    }
  }

  // fs.readdir / fs.copyFile (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsReaddir = (text === "fs.readdir" || (text.endsWith(".readdir") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    const isFsCopyFile = (text === "fs.copyFile" || (text.endsWith(".copyFile") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    if (isFsReaddir) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.readdir (callback)",
        "Effect.promise or fs.promises.readdir"
      )
    }
    if (isFsCopyFile) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.copyFile (callback)",
        "Effect.promise or fs.promises.copyFile"
      )
    }
  }

  // FileReader (browser) -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "FileReader" || text.includes("FileReader")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new FileReader()",
        "Effect.callback or FileReader + Effect.asyncInterrupt"
      )
    }
  }

  // fs.mkdtemp / fs.symlink (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isFsMkdtemp = (text === "fs.mkdtemp" || (text.endsWith(".mkdtemp") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    const isFsSymlink = (text === "fs.symlink" || (text.endsWith(".symlink") && text.startsWith("fs."))) &&
      node.getArguments().length >= 2
    if (isFsMkdtemp) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.mkdtemp (callback)",
        "Effect.promise or fs.promises.mkdtemp"
      )
    }
    if (isFsSymlink) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "fs.symlink (callback)",
        "Effect.promise or fs.promises.symlink"
      )
    }
  }

  // ResizeObserver / IntersectionObserver -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      text === "ResizeObserver" ||
      text === "IntersectionObserver" ||
      text.includes("ResizeObserver") ||
      text.includes("IntersectionObserver")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        `new ${text}()`,
        "Effect.callback or Effect.asyncInterrupt for DOM observation"
      )
    }
  }

  // child_process.fork -> Worker / Effect
  const hasChildProcessFork = sourceFile.getText().includes("child_process")
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.includes("child_process") && text.endsWith(".fork")) ||
      (hasChildProcessFork && text === "fork")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "child_process.fork",
        "effect/workers Worker"
      )
    }
  }

  // AbortController -> Effect.Scoped
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "AbortController" || text.includes("AbortController")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "new AbortController()",
        "Effect.Scoped or Effect.interruptible for cancellation"
      )
    }
  }

  // child_process.exec/spawn -> CommandExecutor
  const fileText = sourceFile.getText()
  const hasChildProcess = fileText.includes("child_process")
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isChildProcessExec = (text.endsWith(".exec") || text.endsWith(".execSync") || text.endsWith(".spawn")) &&
      text.includes("child_process")
    const isNamedImportExec = hasChildProcess && (text === "exec" || text === "execSync" || text === "spawn")
    if (isChildProcessExec || isNamedImportExec) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "child_process.exec/spawn",
        "effect/process Command or Effect.promise"
      )
    }
  }

  // process.env -> Config (only direct process.env to avoid duplicates)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const expr = node.getExpression()
    if (expr.getText() === "process" && node.getName() === "env") {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "process.env",
        "Config.String or Config.schema for typed config"
      )
    }
  }

  // RxJS Observable -> Stream
  const hasRxjs = fileText.includes("rxjs") || fileText.includes("Observable")
  if (hasRxjs) {
    for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = node.getExpression()
      const text = expr.getText()
      if (text.includes("Observable") || (text.includes("of") && text.includes("rxjs"))) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          "RxJS Observable",
          "effect/Stream"
        )
      }
    }
  }
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text.includes("Observable") || text.includes("Subject")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "RxJS Observable/Subject",
        "Stream or PubSub for Effect"
      )
    }
  }

  // requestAnimationFrame -> Effect.sync + queueMicrotask (browser)
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "requestAnimationFrame" || text.endsWith(".requestAnimationFrame")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "requestAnimationFrame",
        "Effect.callback or Effect.sync + queueMicrotask for scheduling"
      )
    }
  }

  // crypto (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.includes("crypto.") || text.includes("randomBytes") || text.includes("scrypt") ||
        text.includes("pbkdf2")) &&
      node.getArguments().length >= 2
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "crypto (callback)",
        "Effect.promise or crypto.webcrypto / node:crypto promises"
      )
    }
  }

  // createReadStream / createWriteStream -> Stream
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      text === "createReadStream" || text === "createWriteStream" || text.endsWith(".createReadStream") ||
      text.endsWith(".createWriteStream")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        text,
        "effect/Stream with the v4 platform adapter"
      )
    }
  }

  // cluster.fork -> Worker / Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text.includes("cluster") && text.endsWith(".fork")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "cluster.fork",
        "effect/workers worker pool"
      )
    }
  }

  // net.createServer / net.connect (callback) -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "createServer" || text === "connect" || text.endsWith(".createServer") || text.endsWith(".connect")) {
      const full = expr.getText()
      if (full.includes("net") || full.includes("tls")) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          full,
          "effect/socket Server"
        )
      }
    }
  }

  // zlib (callback) -> Effect.promise
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      text.includes("zlib.") &&
      (text.includes("deflate") || text.includes("inflate") || text.includes("gzip") || text.includes("gunzip"))
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "zlib (callback)",
        "Effect.promise or zlib.promises"
      )
    }
  }

  // readline.createInterface -> Effect.callback / Stream
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "createInterface" || text.endsWith(".createInterface")) {
      if (text.includes("readline")) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          "readline.createInterface",
          "Effect.callback or Stream for line-by-line reading"
        )
      }
    }
  }

  // stream.pipeline (callback) -> Effect.promise
  const hasStreamModule = sourceFile.getText().includes("stream")
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isStreamPipeline = (text.endsWith(".pipeline") && text.includes("stream")) ||
      (hasStreamModule && text === "pipeline")
    if (isStreamPipeline) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "stream.pipeline (callback)",
        "Effect.promise or stream.promises.pipeline"
      )
    }
  }

  // events.once -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "once" || text.endsWith(".once")) {
      if (text.includes("events") || sourceFile.getText().includes("from 'events'")) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          "events.once",
          "Effect.callback for one-shot event"
        )
      }
    }
  }

  // fs.watch / fs.watchFile (callback) -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "watch" || text === "watchFile" || text.endsWith(".watch") || text.endsWith(".watchFile")) {
      if (text.includes("fs") || expr.getText().includes("fs.")) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          "fs.watch / fs.watchFile",
          "Effect.callback or fs.watch with EventEmitter"
        )
      }
    }
  }

  // vm.runInNewContext / vm.runInContext -> Effect
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.includes("runInNewContext") || text.includes("runInContext") || text.includes("runInThisContext")) &&
      text.includes("vm")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "vm.runIn*",
        "Effect.sync for isolated code execution"
      )
    }
  }

  // url.parse (deprecated) -> new URL()
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if ((text === "parse" || text.endsWith(".parse")) && text.includes("url")) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "url.parse (deprecated)",
        "new URL() or URL.parse for standard parsing"
      )
    }
  }

  // child_process.spawnSync -> Effect.promise / CommandExecutor
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (
      (text.endsWith(".spawnSync") && text.includes("child_process")) ||
      (sourceFile.getText().includes("child_process") && text === "spawnSync")
    ) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "child_process.spawnSync",
        "effect/process Command or Effect.promise"
      )
    }
  }

  // glob (callback) -> Effect.promise / glob promise API
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text === "glob" || text.endsWith(".glob")) {
      const fileContent = sourceFile.getText()
      if (fileContent.includes("glob") && node.getArguments().length >= 2) {
        addOpportunity(
          opportunities,
          filePath,
          node,
          sourceFile,
          "glob (callback)",
          "Effect.promise or glob promise API"
        )
      }
    }
  }

  // assert.throws / expect().rejects (test) -> Effect.runPromiseExit
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    const isAssertThrows = text.includes("assert") && text.endsWith(".throws")
    const isExpectRejects = text.endsWith(".rejects") && text.includes("expect")
    if (isAssertThrows || isExpectRejects) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        isExpectRejects ? "expect().rejects" : "assert.throws",
        "Effect.runPromiseExit + Exit.match for testing Effect failures"
      )
    }
  }

  // tls.connect / tls.createServer -> Effect.callback
  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression()
    const text = expr.getText()
    if (text.includes("tls") && (text.endsWith(".connect") || text.endsWith(".createServer"))) {
      addOpportunity(
        opportunities,
        filePath,
        node,
        sourceFile,
        "tls.connect / tls.createServer",
        "effect/socket TLS"
      )
    }
  }

  return [...patterns, ...opportunities]
}

/**
 * Scan a directory for migration opportunities.
 */
export async function findMigrationOpportunitiesInProject(
  dirPath: string,
  options?: { extensions?: ReadonlyArray<string> }
): Promise<MigrationReport> {
  const extensions = options?.extensions ?? [".ts", ".tsx"]
  const opportunities: Array<MigrationOpportunity> = []
  let fileCount = 0

  async function scan(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name !== "node_modules" && ent.name !== ".git" && ent.name !== "dist") await scan(full)
      } else if (ent.isFile() && extensions.includes(extname(ent.name))) {
        fileCount++
        try {
          opportunities.push(...findMigrationOpportunities(full))
        } catch {
          // Skip files that fail to parse (syntax errors, missing deps, etc.)
        }
      }
    }
  }
  await scan(dirPath)

  return { opportunities, fileCount }
}

/**
 * Format migration report as text.
 */
export function formatMigrationReport(report: MigrationReport): string {
  const lines: Array<string> = []
  lines.push("Migration Opportunities Found:")
  lines.push("")
  for (const o of report.opportunities) {
    lines.push(`  ${o.filePath}:${o.line}:${o.column}  ${o.pattern}`)
    lines.push(`    →  ${o.suggestion}`)
    if (o.explanation) lines.push(`    Why: ${o.explanation}`)
    if (o.codeSnippet) lines.push(`    Snippet: ${o.codeSnippet.slice(0, 60)}...`)
    lines.push("")
  }
  lines.push(`Total: ${report.opportunities.length} opportunities in ${report.fileCount} files`)
  return lines.join("\n")
}
