/**
 * Source-level Effect lint rules.
 *
 * These rules operate on the ts-morph SourceFile (raw AST) for checks the IR
 * cannot express precisely: throw-statement shapes, raw side-effects inside
 * generator bodies, `let` mutation across concurrent effects, and Promise-style
 * `.then()` chains on Effect.runPromise.
 *
 * The output shape matches `LintIssue` from effect-linter so reports compose.
 */

import type { SourceFile, Node, CallExpression } from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type { LintIssue } from './effect-linter';
import { RULE_DOCS } from './source-linter-docs';

interface SourceLintContext {
  readonly filePath: string;
}

const makeLocation = (
  node: Node,
  filePath: string,
): LintIssue['location'] => {
  const start = node.getStart();
  const sf = node.getSourceFile();
  const { line, column } = sf.getLineAndColumnAtPos(start);
  return {
    filePath,
    line,
    column,
  };
};

/**
 * Resolve the receiver of a call expression like `a.b.c(...)` to its leading text,
 * e.g. `Effect.runPromise` for `Effect.runPromise(eff).then(...)`.
 */
const calleeText = (call: CallExpression): string => {
  const expr = call.getExpression();
  return expr.getText();
};

const isInsideEffectGen = (node: Node): boolean => {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.getKindName() === 'CallExpression') {
      const txt = (current as CallExpression).getExpression().getText();
      if (txt === 'Effect.gen' || txt === 'Stream.gen' || txt === 'Layer.effect') {
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
};

const isInsideEffectSyncOrTry = (node: Node): boolean => {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.getKindName() === 'CallExpression') {
      const txt = (current as CallExpression).getExpression().getText();
      if (
        txt === 'Effect.sync' ||
        txt === 'Effect.try' ||
        txt === 'Effect.tryPromise' ||
        txt === 'Effect.promise'
      ) {
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
};

const isInsideParallelEffect = (node: Node): boolean => {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (current.getKindName() === 'CallExpression') {
      const txt = (current as CallExpression).getExpression().getText();
      if (
        txt === 'Effect.all' ||
        txt === 'Effect.allWith' ||
        txt === 'Effect.fork' ||
        txt === 'Effect.forkDaemon' ||
        txt === 'Effect.forkScoped' ||
        txt === 'Effect.forEach' ||
        txt === 'Effect.race' ||
        txt === 'Effect.raceAll'
      ) {
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
};

// ===========================================================================
// untagged-throw
// ===========================================================================

/**
 * Walk up to find the immediate enclosing Effect-context call. Returns the
 * call's text + first argument so the caller can decide whether the throw is
 * idiomatic (Effect.try with catch) or a real defect/escape.
 */
const findImmediateEffectCallContext = (
  node: Node,
): { calleeText: string; call: CallExpression } | undefined => {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (cur.getKindName() === 'CallExpression') {
      const call = cur as CallExpression;
      const txt = call.getExpression().getText();
      if (
        txt === 'Effect.gen' ||
        txt === 'Stream.gen' ||
        txt === 'Layer.effect' ||
        txt === 'Effect.sync' ||
        txt === 'Effect.try' ||
        txt === 'Effect.tryPromise' ||
        txt === 'Effect.promise' ||
        txt === 'Effect.callback' ||
        txt === 'Effect.asyncEffect'
      ) {
        return { calleeText: txt, call };
      }
    }
    cur = cur.getParent();
  }
  return undefined;
};

const tryHasCatchField = (call: CallExpression): boolean => {
  const { SyntaxKind } = loadTsMorph();
  const args = call.getArguments();
  const first = args[0];
  if (first?.getKindName() !== 'ObjectLiteralExpression') return false;
  const obj = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  return obj.getProperties().some((p) => {
    if (p.getKindName() !== 'PropertyAssignment' && p.getKindName() !== 'ShorthandPropertyAssignment') return false;
    const name =
      p.getKindName() === 'PropertyAssignment'
        ? p.asKindOrThrow(SyntaxKind.PropertyAssignment).getName()
        : p.asKindOrThrow(SyntaxKind.ShorthandPropertyAssignment).getName();
    return name === 'catch';
  });
};

const checkUntaggedThrow = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const stmt of sf.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    const expr = stmt.getExpression();
    if (expr?.getKindName() !== 'NewExpression') continue;
    const newExpr = expr.asKindOrThrow(SyntaxKind.NewExpression);
    const name = newExpr.getExpression().getText();
    if (name !== 'Error' && name !== 'TypeError' && name !== 'RangeError') continue;

    const ctxCall = findImmediateEffectCallContext(stmt);
    if (!ctxCall) continue;

    // Throws inside Effect.try({ try, catch }) or Effect.tryPromise({ try, catch })
    // are IDIOMATIC — the catch handler maps them to a typed error. Don't flag.
    if (
      (ctxCall.calleeText === 'Effect.try' || ctxCall.calleeText === 'Effect.tryPromise') &&
      tryHasCatchField(ctxCall.call)
    ) {
      continue;
    }

    issues.push({
      rule: 'untagged-throw',
      message: `throw new ${name}(...) inside ${ctxCall.calleeText} — escapes the typed error channel; use Effect.fail with a tagged error or add a catch handler.`,
      severity: 'warning',
      location: makeLocation(stmt, ctx.filePath),
      suggestion:
        'Define a Data.TaggedError class and use Effect.fail(new MyError({...})), or, inside Effect.try/tryPromise, add a catch handler that maps the thrown value to a typed error.',
    });
  }
  return issues;
};

// ===========================================================================
// raw-side-effect-in-gen
// ===========================================================================

const RAW_SIDE_EFFECT_CALLEES = new Set<string>([
  'fetch',
  'Math.random',
  'Date.now',
  'crypto.randomUUID',
  'crypto.randomBytes',
  'setTimeout',
  'setInterval',
]);

const RAW_SIDE_EFFECT_ACCESSES = new Set<string>([
  'process.env',
]);

const checkRawSideEffectInGen = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];

  // CallExpressions: fetch(...), Math.random(), Date.now(), crypto.randomUUID()
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (!RAW_SIDE_EFFECT_CALLEES.has(name)) continue;
    if (!isInsideEffectGen(call)) continue;
    // Skip if already wrapped in Effect.sync/try/tryPromise/promise
    if (isInsideEffectSyncOrTry(call)) continue;
    issues.push({
      rule: 'raw-side-effect-in-gen',
      message: `Bare ${name}(...) inside Effect.gen body — should be wrapped (Effect.sync / tryPromise) or behind a service.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        name === 'fetch'
          ? 'Wrap in Effect.tryPromise({ try: () => fetch(...), catch: ... }) or use HttpClient.'
          : `Wrap in Effect.sync(() => ${name}()) or inject a service (e.g. Random, Clock).`,
    });
  }

  // PropertyAccessExpressions: process.env.X
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const head = pa.getText();
    if (!head.startsWith('process.env')) continue;
    if (!isInsideEffectGen(pa)) continue;
    if (isInsideEffectSyncOrTry(pa)) continue;
    issues.push({
      rule: 'raw-side-effect-in-gen',
      message: 'process.env access inside Effect.gen body — should use Config.string / Config.redacted.',
      severity: 'warning',
      location: makeLocation(pa, ctx.filePath),
      suggestion:
        'Use Config.string("MY_VAR") (or Config.redacted for secrets) to read environment variables.',
    });
  }
  // Also flag bare ElementAccess: process.env["X"]
  for (const ea of sf.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const ex = ea.getExpression().getText();
    if (ex !== 'process.env') continue;
    if (!isInsideEffectGen(ea)) continue;
    if (isInsideEffectSyncOrTry(ea)) continue;
    issues.push({
      rule: 'raw-side-effect-in-gen',
      message: 'process.env[...] access inside Effect.gen body — should use Config.string / Config.redacted.',
      severity: 'warning',
      location: makeLocation(ea, ctx.filePath),
      suggestion:
        'Use Config.string("MY_VAR") (or Config.redacted for secrets) to read environment variables.',
    });
  }
  // NewExpression: new Promise(...)
  for (const ne of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const ctor = ne.getExpression().getText();
    if (ctor !== 'Promise') continue;
    if (!isInsideEffectGen(ne)) continue;
    if (isInsideEffectSyncOrTry(ne)) continue;
    issues.push({
      rule: 'raw-side-effect-in-gen',
      message: 'Bare new Promise(...) inside Effect.gen body — should use Effect.promise/Effect.callback.',
      severity: 'warning',
      location: makeLocation(ne, ctx.filePath),
      suggestion:
        'Use Effect.promise(() => ...) or Effect.callback(...) so interruption/error handling remain in Effect.',
    });
  }
  // Be aware that RAW_SIDE_EFFECT_ACCESSES is reserved for future patterns.
  RAW_SIDE_EFFECT_ACCESSES.has('process.env');

  return issues;
};

// ===========================================================================
// mutable-in-concurrent
// ===========================================================================

const checkMutableInConcurrent = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];

  // Look for AssignmentExpression with a binary operator that mutates, inside a parallel context.
  // Heuristic: find BinaryExpression where operator is '=' / '+=' / etc., LHS identifier resolves to outer `let`.
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = bin.getOperatorToken().getText();
    if (
      op !== '=' &&
      op !== '+=' &&
      op !== '-=' &&
      op !== '*=' &&
      op !== '/=' &&
      op !== '%='
    ) {
      continue;
    }
    if (!isInsideParallelEffect(bin)) continue;

    const lhs = bin.getLeft();
    if (lhs.getKindName() !== 'Identifier') continue;
    const id = lhs.asKindOrThrow(SyntaxKind.Identifier);
    const sym = id.getSymbol();
    if (!sym) continue;
    const decls = sym.getDeclarations();
    if (decls.length === 0) continue;
    // Check if any declaration is a VariableDeclaration with `let` flag (not const).
    const isLet = decls.some((d) => {
      const vd = d.asKind(SyntaxKind.VariableDeclaration);
      if (!vd) return false;
      const list = vd.getParent();
      if (!list) return false;
      // VariableDeclarationList text starts with 'let ' or 'var '
      const txt = list.getText();
      return /^\s*(let|var)\b/.test(txt);
    });
    if (!isLet) continue;

    // Skip if the let was declared inside the same callback as this assignment.
    // (i.e. the let is not shared across branches.)
    const letDecl = decls[0];
    if (!letDecl) continue;
    // If the closest CallExpression ancestor of the assignment is the same as
    // the closest CallExpression ancestor of the declaration, treat as local.
    const findParallelAncestor = (n: Node): Node | undefined => {
      let cur: Node | undefined = n.getParent();
      while (cur) {
        if (cur.getKindName() === 'CallExpression') {
          const txt = (cur as CallExpression).getExpression().getText();
          if (
            txt === 'Effect.all' ||
            txt === 'Effect.allWith' ||
            txt === 'Effect.fork' ||
            txt === 'Effect.forkDaemon' ||
            txt === 'Effect.forkScoped' ||
            txt === 'Effect.forEach' ||
            txt === 'Effect.race' ||
            txt === 'Effect.raceAll'
          ) {
            return cur;
          }
        }
        cur = cur.getParent();
      }
      return undefined;
    };
    const binParallel = findParallelAncestor(bin);
    const declParallel = findParallelAncestor(letDecl);
    if (binParallel === declParallel) continue; // declared and used inside the same parallel — still suspicious but skip

    issues.push({
      rule: 'mutable-in-concurrent',
      message: `Mutable variable "${id.getText()}" assigned inside a parallel/forked Effect — race-prone.`,
      severity: 'warning',
      location: makeLocation(bin, ctx.filePath),
      suggestion:
        'Replace shared let/var with Ref.make + Ref.update, or Atomic primitives, or return values from each branch.',
    });
  }

  return issues;
};

// ===========================================================================
// runPromise-then-chain
// ===========================================================================

const checkRunPromiseThenChain = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.runPromise' && name !== 'Effect.runPromiseExit') continue;
    // Look at the parent: is it a property-access like `.then`, `.catch`, `.finally`?
    const parent = call.getParent();
    if (!parent) continue;
    if (parent.getKindName() !== 'PropertyAccessExpression') continue;
    const pa = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const propName = pa.getName();
    if (propName !== 'then' && propName !== 'catch' && propName !== 'finally') continue;
    issues.push({
      rule: 'runPromise-then-chain',
      message: `${name}(...).${propName}() — leaving Effect to chain Promise methods loses error typing and tracing.`,
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Use Effect.map / Effect.flatMap / Effect.catch BEFORE runPromise. If you must escape, do it at the entry point.',
    });
  }
  return issues;
};

// ===========================================================================
// runSync-on-async
// ===========================================================================

const checkRunSyncOnAsync = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  const isAsyncEffectText = (text: string): boolean =>
    /Effect\.promise\b/.test(text) ||
    /Effect\.tryPromise\b/.test(text) ||
    /Effect\.async\b/.test(text) ||
    /Effect\.asyncEffect\b/.test(text) ||
    /Effect\.sleep\b/.test(text);

  // Build a set of file-level identifiers that look async-tainted: variables initialised
  // with Effect.promise / Effect.tryPromise / Effect.callback* / Effect.sleep.
  const asyncIdents = new Set<string>();
  for (const vd of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = vd.getInitializer();
    if (!init) continue;
    const text = init.getText();
    if (isAsyncEffectText(text)) {
      const name = vd.getName();
      asyncIdents.add(name);
    }
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = calleeText(call);
    if (callee !== 'Effect.runSync' && callee !== 'Effect.runSyncExit') continue;
    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args[0]?.getText() ?? '';
    // Direct uses
    if (isAsyncEffectText(argText)) {
      issues.push({
        rule: callee === 'Effect.runSync' ? 'runSync-on-async' : 'runSyncExit-on-async',
        message: `${callee} on an effect that uses Effect.promise/tryPromise/async/sleep — will throw at runtime.`,
        severity: 'error',
        location: makeLocation(call, ctx.filePath),
        suggestion:
          callee === 'Effect.runSync'
            ? 'Use Effect.runPromise (or Effect.runPromiseExit) for async effects.'
            : 'Use Effect.runPromiseExit for async effects.',
      });
      continue;
    }
    // Refers to a known async-tainted identifier
    const referenced = argText.split(/[^A-Za-z0-9_$]/).filter(Boolean);
    if (referenced.some((id) => asyncIdents.has(id))) {
      issues.push({
        rule: callee === 'Effect.runSync' ? 'runSync-on-async' : 'runSyncExit-on-async',
        message: `${callee} on "${argText}" — that effect transitively uses Effect.promise/tryPromise/async.`,
        severity: 'error',
        location: makeLocation(call, ctx.filePath),
        suggestion:
          callee === 'Effect.runSync'
            ? 'Use Effect.runPromise (or Effect.runPromiseExit) for async effects.'
            : 'Use Effect.runPromiseExit for async effects.',
      });
    }
  }
  return issues;
};

// ===========================================================================
// live-layer-in-test
// ===========================================================================

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
const TEST_DIR_PATTERN = /(^|[\\/])(__tests__|test|tests)([\\/]|$)/;
const isTestFilePath = (filePath: string): boolean =>
  TEST_FILE_PATTERN.test(filePath) || TEST_DIR_PATTERN.test(filePath);

const checkLiveLayerInTest = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  if (!isTestFilePath(ctx.filePath)) return [];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const isIntegrationTest =
    /(^|[\\/])(integration)([\\/]|[.])/i.test(ctx.filePath);
  const isRuntimeUse = (node: Node): boolean => {
    const parent = node.getParent();
    if (!parent) return true;
    const pk = parent.getKindName();
    if (
      pk === 'ImportSpecifier' ||
      pk === 'ImportClause' ||
      pk === 'NamespaceImport' ||
      pk === 'NamedImports' ||
      pk === 'TypeReference' ||
      pk === 'TypeAliasDeclaration' ||
      pk === 'InterfaceDeclaration' ||
      pk === 'TypeLiteral'
    ) {
      return false;
    }
    return true;
  };
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    if (!name.endsWith("Live")) continue;
    if (name === 'Live') continue;
    // Live LAYERS are PascalCase constants (UserRepoLive, DbLive).
    // Skip camelCase helpers (runLive, connectLive) and TTL API methods
    // like describeTimeToLive / updateTimeToLive.
    if (!/^[A-Z]/.test(name)) continue;
    if (name.endsWith("TimeToLive")) continue;
    if (seen.has(name)) continue;
    const refs = id.findReferencesAsNodes().filter((ref) =>
      ref.getSourceFile().getFilePath() === sf.getFilePath(),
    );
    const runtimeRef = refs.find((ref) => isRuntimeUse(ref));
    if (!runtimeRef) continue;
    seen.add(name);
    issues.push({
      rule: 'live-layer-in-test',
      message: `Test file references "${name}" — a Live layer should not be wired into tests.`,
      severity: isIntegrationTest ? 'info' : 'warning',
      location: makeLocation(runtimeRef, ctx.filePath),
      suggestion:
        'Provide a Test layer (e.g. ServiceTest) or use Layer.succeed with a stub implementation.',
    });
    // Only flag the first occurrence per identifier per file.
  }
  return issues;
};

// ===========================================================================
// nondeterministic-test-api
// ===========================================================================

const checkNondeterministicTestApi = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  if (!isTestFilePath(ctx.filePath)) return [];
  const issues: LintIssue[] = [];

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name === 'Date.now' || name === 'Math.random') {
      issues.push({
        rule: 'nondeterministic-test-api',
        message: `${name}() in test code introduces non-determinism.`,
        severity: 'warning',
        location: makeLocation(call, ctx.filePath),
        suggestion:
          name === 'Date.now'
            ? 'Use Effect Clock/TestClock or inject a deterministic timestamp source.'
            : 'Inject a deterministic RNG or use Effect Random/Test services in tests.',
      });
    }
  }

  for (const ctor of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (ctor.getExpression().getText() !== 'Date') continue;
    const args = ctor.getArguments();
    if (args.length > 0) continue;
    issues.push({
      rule: 'nondeterministic-test-api',
      message: 'new Date() in test code introduces non-determinism.',
      severity: 'warning',
      location: makeLocation(ctor, ctx.filePath),
      suggestion: 'Use a fixed date literal or inject time via Effect Clock/TestClock.',
    });
  }

  return issues;
};

// ===========================================================================
// detached-fiber-in-test
// ===========================================================================

const checkDetachedFiberInTest = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  if (!isTestFilePath(ctx.filePath)) return [];
  const issues: LintIssue[] = [];

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (
      name !== 'Effect.runFork' &&
      name !== 'Effect.runForkWith' &&
      name !== 'Runtime.runFork'
    ) {
      continue;
    }
    issues.push({
      rule: 'detached-fiber-in-test',
      message: `${name}(...) in test code can outlive the test and cause flakiness.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Prefer runPromise/runPromiseExit and await completion, or keep and join/interrupt the returned Fiber explicitly.',
    });
  }

  return issues;
};

// ===========================================================================
// sleep-without-testclock
// ===========================================================================

const checkSleepWithoutTestClockInTest = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  if (!isTestFilePath(ctx.filePath)) return [];
  const hasTestClock = sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((id) => id.getText() === 'TestClock');
  if (hasTestClock) return [];
  const issues: LintIssue[] = [];

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.sleep') continue;
    issues.push({
      rule: 'sleep-without-testclock',
      message: 'Effect.sleep(...) in test code without TestClock usage makes tests slow and timing-sensitive.',
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Use TestClock.adjust/adjustTo and provide test clock services to keep tests deterministic and fast.',
    });
  }
  return issues;
};

// ===========================================================================
// console-log-in-effect
// ===========================================================================

const CONSOLE_METHODS = new Set<string>([
  'console.log',
  'console.info',
  'console.warn',
  'console.error',
  'console.debug',
  'console.trace',
]);

const checkConsoleInEffect = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (!CONSOLE_METHODS.has(name)) continue;
    if (!isInsideEffectGen(call)) continue;
    if (isInsideEffectSyncOrTry(call)) continue;
    const method = name.split('.')[1] ?? 'log';
    const effectFn =
      method === 'warn'
        ? 'Effect.logWarning'
        : method === 'error'
          ? 'Effect.logError'
          : method === 'debug'
            ? 'Effect.logDebug'
            : method === 'info'
              ? 'Effect.logInfo'
              : 'Effect.log';
    issues.push({
      rule: 'console-log-in-effect',
      message: `${name}(...) inside Effect.gen body — loses span/fiber context; use ${effectFn}.`,
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion: `Use yield* ${effectFn}(...) so the message participates in Effect's logger and tracing.`,
    });
  }
  return issues;
};

// ===========================================================================
// promise-api-in-gen
// ===========================================================================

const PROMISE_API_REPLACEMENTS: Record<string, string> = {
  'Promise.all': 'Effect.all',
  'Promise.allSettled': 'Effect.all (with { mode: "either" })',
  'Promise.race': 'Effect.race / Effect.raceAll',
  'Promise.any': 'Effect.raceAll',
  'Promise.resolve': 'Effect.succeed',
  'Promise.reject': 'Effect.fail',
};

const checkPromiseApiInGen = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    const replacement = PROMISE_API_REPLACEMENTS[name];
    if (!replacement) continue;
    if (!isInsideEffectGen(call)) continue;
    if (isInsideEffectSyncOrTry(call)) continue;
    issues.push({
      rule: 'promise-api-in-gen',
      message: `${name}(...) inside Effect.gen — Promise APIs bypass interruption and typed errors; use ${replacement}.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion: `Replace ${name}(...) with ${replacement}(...) so Effect can manage concurrency and interruption.`,
    });
  }
  return issues;
};

// ===========================================================================
// effect-fail-untagged
// ===========================================================================

const BUILTIN_ERROR_CTORS = new Set<string>([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
]);

const checkEffectFailUntagged = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.fail' && name !== 'Effect.failSync') continue;
    const args = call.getArguments();
    const first = args[0];
    if (!first) continue;
    // Direct: Effect.fail(new Error("..."))
    if (first.getKindName() === 'NewExpression') {
      const newExpr = first.asKindOrThrow(SyntaxKind.NewExpression);
      const ctor = newExpr.getExpression().getText();
      if (BUILTIN_ERROR_CTORS.has(ctor)) {
        issues.push({
          rule: 'effect-fail-untagged',
          message: `${name}(new ${ctor}(...)) — error channel becomes a built-in Error; downstream catchTag cannot discriminate.`,
          severity: 'warning',
          location: makeLocation(call, ctx.filePath),
          suggestion:
            'Define a Data.TaggedError class (e.g. class FetchError extends Data.TaggedError("FetchError")<{ ... }>{}) and fail with that.',
        });
        continue;
      }
    }
    // Effect.failSync(() => new Error("..."))
    if (
      name === 'Effect.failSync' &&
      (first.getKindName() === 'ArrowFunction' || first.getKindName() === 'FunctionExpression')
    ) {
      const text = first.getText();
      // Look for `new <BuiltinError>(` inside the arrow body.
      const m = /new\s+(Error|TypeError|RangeError|SyntaxError|ReferenceError|URIError|EvalError)\b/.exec(text);
      if (m) {
        issues.push({
          rule: 'effect-fail-untagged',
          message: `${name}(() => new ${m[1]}(...)) — error channel becomes a built-in Error; downstream catchTag cannot discriminate.`,
          severity: 'warning',
          location: makeLocation(call, ctx.filePath),
          suggestion:
            'Return a Data.TaggedError instance instead of a built-in Error so the typed error channel stays discriminable.',
        });
      }
    }
  }
  return issues;
};

// ===========================================================================
// run-effect-in-gen
// ===========================================================================

const EFFECT_RUNNERS = new Set<string>([
  'Effect.runPromise',
  'Effect.runPromiseExit',
  'Effect.runSync',
  'Effect.runSyncExit',
  'Effect.runFork',
  'Effect.runForkExit',
  'Effect.runCallback',
]);

const checkRunEffectInGen = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (!EFFECT_RUNNERS.has(name)) continue;
    if (!isInsideEffectGen(call)) continue;
    issues.push({
      rule: 'run-effect-in-gen',
      message: `${name}(...) inside Effect.gen — creates a nested runtime and breaks fiber/tracing context.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Compose with yield* on the inner effect instead of calling a runner. Reserve run* for program entry points.',
    });
  }
  return issues;
};

// ===========================================================================
// forEach-without-concurrency
// ===========================================================================

const checkForEachWithoutConcurrency = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.forEach' && name !== 'Stream.runForEach') continue;
    const args = call.getArguments();
    // Two-arg form: Effect.forEach(iterable, fn) — no options object.
    // Three-arg form: Effect.forEach(iterable, fn, options) — explicit.
    if (args.length !== 2) continue;
    issues.push({
      rule: 'forEach-without-concurrency',
      message: `${name}(...) without options — defaults to sequential execution; make the choice explicit.`,
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Pass an explicit options object: { concurrency: "unbounded" } for parallel, or { concurrency: 1 } if sequential is intentional.',
    });
  }
  return issues;
};

// ===========================================================================
// identity-catch
// ===========================================================================

/**
 * A "catch handler" is identity when it just re-fails with the same value it
 * received, e.g. `Effect.catch((e) => Effect.fail(e))`. These add noise
 * without changing semantics and are usually leftover from refactors.
 */

const CATCH_RECEIVERS: Record<string, 'Effect.fail' | 'Effect.failCause' | 'Effect.die'> = {
  'Effect.catch': 'Effect.fail',
  'Effect.catchCause': 'Effect.failCause',
  'Effect.catchDefect': 'Effect.die',
  'Effect.catchTag': 'Effect.fail',
};

const isIdentityHandler = (
  argNode: Node,
  expectedReFail: 'Effect.fail' | 'Effect.failCause' | 'Effect.die',
): boolean => {
  const kind = argNode.getKindName();
  if (kind !== 'ArrowFunction' && kind !== 'FunctionExpression') return false;
  const text = argNode.getText();
  // (NAME) => Effect.fail(NAME) — optional type annotation, optional braces.
  const arrow = /^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^)]*)?\)\s*=>\s*([\s\S]*)$/.exec(text);
  const fn = /^function\s*\*?\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^)]*)?\)\s*\{\s*return\s+([\s\S]+?);?\s*\}$/.exec(text);
  const match = arrow ?? fn;
  if (!match) return false;
  const param = match[1];
  let body = (match[2] ?? '').trim();
  // Strip leading `{ return ` / trailing `; }` if the arrow uses a block body.
  const block = /^\{\s*return\s+([\s\S]+?);?\s*\}$/.exec(body);
  if (block) body = block[1]!.trim();
  body = body.replace(/;\s*$/, '');
  return body === `${expectedReFail}(${param})`;
};

const findFunctionArg = (call: CallExpression): Node | undefined => {
  // Scan from the end — the handler is conventionally the last argument.
  const args = call.getArguments();
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i]!;
    const k = arg.getKindName();
    if (k === 'ArrowFunction' || k === 'FunctionExpression') return arg;
  }
  return undefined;
};

const checkIdentityCatch = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    const expectedReFail = CATCH_RECEIVERS[name];
    if (!expectedReFail) continue;
    const handler = findFunctionArg(call);
    if (!handler) continue;
    if (!isIdentityHandler(handler, expectedReFail)) continue;
    issues.push({
      rule: 'identity-catch',
      message: `${name}(...) handler just re-fails the same value — the catch is a no-op.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion: `Remove the ${name}(...) call, or replace it with a real recovery / mapping handler.`,
    });
  }
  return issues;
};

// ===========================================================================
// empty-effect-all
// ===========================================================================

const checkEmptyEffectAll = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.all' && name !== 'Effect.allWith') continue;
    const first = call.getArguments()[0];
    if (!first) continue;
    const k = first.getKindName();
    let empty = false;
    if (k === 'ArrayLiteralExpression') {
      const arr = first.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      empty = arr.getElements().length === 0;
    } else if (k === 'ObjectLiteralExpression') {
      const obj = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      empty = obj.getProperties().length === 0;
    }
    if (!empty) continue;
    issues.push({
      rule: 'empty-effect-all',
      message: `${name}(${k === 'ArrayLiteralExpression' ? '[]' : '{}'}) — always succeeds with an empty result; usually dead code.`,
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Remove this branch, or replace with Effect.succeed([]) / Effect.succeed({}) if a literal empty value is intentional.',
    });
  }
  return issues;
};

// ===========================================================================
// layer-duplicate-merge
// ===========================================================================

const checkLayerDuplicateMerge = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Layer.merge' && name !== 'Layer.mergeAll' && name !== 'Layer.provideMerge') continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    const seen = new Map<string, number>();
    args.forEach((arg, idx) => {
      const text = arg.getText().trim();
      // Only flag clearly identifier-like arguments — skip inline Layer.succeed/effect calls.
      if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(text)) return;
      const prev = seen.get(text);
      if (prev === undefined) {
        seen.set(text, idx);
      } else {
        issues.push({
          rule: 'layer-duplicate-merge',
          message: `${name}(...) lists "${text}" more than once — later occurrences override earlier ones.`,
          severity: 'warning',
          location: makeLocation(arg, ctx.filePath),
          suggestion:
            'Remove the duplicate, or rename the second argument if you meant a different layer.',
        });
      }
    });
  }
  return issues;
};

// ===========================================================================
// schedule-unbounded
// ===========================================================================

/**
 * Looks for `Schedule.forever` and `Schedule.spaced(...)` usages that are NOT
 * composed with a bounding combinator inside the same surrounding pipe / call
 * chain. Common bounding combinators: `Schedule.upTo`, `Schedule.recurs`,
 * `Schedule.intersect`, `Schedule.tapOutput`, and `.compose`.
 *
 * This is intentionally conservative: we only check the immediate textual
 * `pipe(...)` ancestor (or the chain of property accesses) of the schedule
 * expression. False negatives are preferred to false positives.
 */
const SCHEDULE_BOUNDS = [
  'Schedule.upTo',
  'Schedule.recurs',
  'Schedule.intersect',
  'Schedule.intersectWith',
  'Schedule.compose',
  'Schedule.union',
  'Schedule.unionWith',
  'Schedule.upToFirstAttempt',
];

const findEnclosingPipeOrChain = (node: Node): Node | undefined => {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    const k = cur.getKindName();
    if (k === 'CallExpression') {
      const expr = (cur as CallExpression).getExpression().getText();
      if (expr === 'pipe' || expr.endsWith('.pipe')) return cur;
    }
    if (k === 'PropertyAccessExpression') {
      cur = cur.getParent();
      continue;
    }
    if (k === 'SourceFile' || k === 'Block' || k === 'VariableStatement' || k === 'ExpressionStatement') {
      return undefined;
    }
    cur = cur.getParent();
  }
  return undefined;
};

const checkScheduleUnbounded = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  const candidates: { node: Node; label: string }[] = [];

  // Schedule.forever (an identifier / property access, not a call)
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pa.getText() === 'Schedule.forever') {
      // If parent is a property access (e.g. Schedule.forever.foo), skip — covered separately.
      const parent = pa.getParent();
      if (parent?.getKindName() === 'PropertyAccessExpression') continue;
      candidates.push({ node: pa, label: 'Schedule.forever' });
    }
  }
  // Schedule.spaced(...) — a call.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (calleeText(call) === 'Schedule.spaced') {
      candidates.push({ node: call, label: 'Schedule.spaced(...)' });
    }
  }

  for (const { node, label } of candidates) {
    // Stream context: Stream.repeat / fromSchedule / tick — infinite is by design.
    // The stream consumer controls demand; the schedule does not "retry forever" — it
    // emits forever, and `Stream.take(n)` etc. bound it at the consumer.
    let isStreamScheduleConsumer = false;
    {
      let cur: Node | undefined = node.getParent();
      while (cur) {
        if (cur.getKindName() === 'CallExpression') {
          const callee = (cur as CallExpression).getExpression().getText();
          if (
            callee === 'Stream.repeat' ||
            callee === 'Stream.repeatEffect' ||
            callee === 'Stream.repeatEffectOption' ||
            callee === 'Stream.fromSchedule' ||
            callee === 'Stream.tick' ||
            callee === 'Stream.repeatValue'
          ) {
            isStreamScheduleConsumer = true;
            break;
          }
        }
        cur = cur.getParent();
      }
    }
    if (isStreamScheduleConsumer) continue;

    const pipeOrChain = findEnclosingPipeOrChain(node);
    let containerText = pipeOrChain ? pipeOrChain.getText() : '';
    if (!containerText) {
      // Look at the enclosing variable / argument expression as a fallback.
      let cur: Node | undefined = node.getParent();
      while (cur) {
        const k = cur.getKindName();
        if (
          k === 'VariableDeclaration' ||
          k === 'ReturnStatement' ||
          k === 'PropertyAssignment' ||
          k === 'CallExpression'
        ) {
          containerText = cur.getText();
          break;
        }
        cur = cur.getParent();
      }
    }
    const bounded = SCHEDULE_BOUNDS.some((b) => containerText.includes(b));
    if (bounded) continue;
    issues.push({
      rule: 'schedule-unbounded',
      message: `${label} is not composed with a bounding combinator — retries can run forever.`,
      severity: 'info',
      location: makeLocation(node, ctx.filePath),
      suggestion:
        'Compose with Schedule.upTo / Schedule.recurs / Schedule.intersect to cap total elapsed time or attempt count.',
    });
  }
  return issues;
};

// ===========================================================================
// config-secret-without-redacted
// ===========================================================================

const SECRET_TOKENS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'private_key',
  'privatekey',
  'credential',
  'auth_key',
  'authkey',
  'access_key',
  'accesskey',
  'session_key',
  'sessionkey',
  'client_secret',
  'refresh_token',
];

const stringLiteralValue = (node: Node): string | undefined => {
  const k = node.getKindName();
  if (k !== 'StringLiteral' && k !== 'NoSubstitutionTemplateLiteral') return undefined;
  // Strip the surrounding quotes from the raw text.
  const raw = node.getText();
  return raw.slice(1, -1);
};

const looksLikeSecret = (value: string): string | undefined => {
  const lower = value.toLowerCase();
  for (const tok of SECRET_TOKENS) {
    if (lower.includes(tok)) return tok;
  }
  return undefined;
};

const checkConfigSecretWithoutRedacted = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    // Only flag the explicitly-cleartext readers; Config.redacted is fine.
    if (
      name !== 'Config.string' &&
      name !== 'Config.nonEmptyString' &&
      name !== 'Config.secret' // older Effect alias, also visible-in-logs
    ) {
      continue;
    }
    const first = call.getArguments()[0];
    if (!first) continue;
    const lit = stringLiteralValue(first);
    if (!lit) continue;
    const matched = looksLikeSecret(lit);
    if (!matched) continue;
    issues.push({
      rule: 'config-secret-without-redacted',
      message: `${name}(${JSON.stringify(lit)}) reads a likely-secret env var as plain text — leaks through logs/errors.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion: `Use Config.redacted(${JSON.stringify(lit)}) so the value is hidden from logs/inspect (matched on "${matched}").`,
    });
  }
  return issues;
};

// ===========================================================================
// return-effect-from-sync
// ===========================================================================

const EFFECT_CONSTRUCTOR_NAMES = new Set<string>([
  'Effect.succeed',
  'Effect.fail',
  'Effect.die',
  'Effect.failSync',
  'Effect.gen',
  'Effect.sync',
  'Effect.try',
  'Effect.promise',
  'Effect.tryPromise',
  'Effect.callback',
  'Effect.asyncEffect',
  'Effect.flatMap',
  'Effect.map',
  'Effect.tap',
  'Effect.all',
  'Effect.zip',
  'Effect.zipWith',
  'Effect.race',
  'Effect.raceAll',
  'Effect.forEach',
  'Effect.fromOption',
  'Effect.fromEither',
  'Effect.fromNullable',
  'Effect.never',
  'Effect.suspend',
]);

const checkReturnEffectFromSync = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.sync' && name !== 'Effect.try') continue;
    // Effect.try can take an object form { try, catch } — use first non-options arrow.
    let arrow: Node | undefined;
    for (const arg of call.getArguments()) {
      const k = arg.getKindName();
      if (k === 'ArrowFunction' || k === 'FunctionExpression') {
        arrow = arg;
        break;
      }
      if (k === 'ObjectLiteralExpression') {
        const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
        for (const p of obj.getProperties()) {
          if (p.getKindName() !== 'PropertyAssignment') continue;
          const pa = p.asKindOrThrow(SyntaxKind.PropertyAssignment);
          if (pa.getName() !== 'try') continue;
          const init = pa.getInitializer();
          if (!init) continue;
          const initK = init.getKindName();
          if (initK === 'ArrowFunction' || initK === 'FunctionExpression') {
            arrow = init;
          }
        }
      }
      if (arrow) break;
    }
    if (!arrow) continue;
    // Look at the body expression. We want to flag when the body's outermost
    // call expression's callee is an Effect.* constructor.
    let bodyExpr: Node | undefined;
    if (arrow.getKindName() === 'ArrowFunction') {
      const fn = arrow.asKindOrThrow(SyntaxKind.ArrowFunction);
      const b = fn.getBody();
      const bk = b.getKindName();
      if (bk === 'Block') {
        // function-style body: find a single `return X;` and grab X.
        const block = b.asKindOrThrow(SyntaxKind.Block);
        const stmts = block.getStatements();
        if (stmts.length !== 1) continue;
        const only = stmts[0]!;
        if (only.getKindName() !== 'ReturnStatement') continue;
        bodyExpr = only.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
      } else {
        bodyExpr = b;
      }
    } else {
      const fn = arrow.asKindOrThrow(SyntaxKind.FunctionExpression);
      const block = fn.getBody().asKind(SyntaxKind.Block);
      if (!block) continue;
      const stmts = block.getStatements();
      if (stmts.length !== 1) continue;
      const only = stmts[0]!;
      if (only.getKindName() !== 'ReturnStatement') continue;
      bodyExpr = only.asKindOrThrow(SyntaxKind.ReturnStatement).getExpression();
    }
    if (bodyExpr?.getKindName() !== 'CallExpression') continue;
    const inner = bodyExpr.asKindOrThrow(SyntaxKind.CallExpression);
    const innerName = inner.getExpression().getText();
    if (!EFFECT_CONSTRUCTOR_NAMES.has(innerName)) continue;
    issues.push({
      rule: 'return-effect-from-sync',
      message: `${name}(() => ${innerName}(...)) — wraps an Effect inside an Effect; result type becomes Effect<Effect<...>>.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        name === 'Effect.sync'
          ? `Drop the Effect.sync wrapper and use ${innerName}(...) directly, or use Effect.suspend(() => ${innerName}(...)) if you need lazy evaluation.`
          : `Use Effect.suspend(() => ${innerName}(...)) for lazy evaluation, or Effect.flatMap if you need the inner Effect to run.`,
    });
  }
  return issues;
};

// ===========================================================================
// yield-promise
// ===========================================================================

/**
 * `yield* somePromise` inside an `Effect.gen` body crashes at runtime — the
 * runtime expects Effects. Detect when the operand is a NewExpression that
 * constructs a Promise, a CallExpression with `.then` on the receiver, or
 * literal `Promise.resolve/reject/all/...` calls.
 */
const checkYieldPromise = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];

  // YieldExpressions whose asterisk is set (i.e. `yield* x`) and operand looks like a Promise.
  for (const ye of sf.getDescendantsOfKind(SyntaxKind.YieldExpression)) {
    if (!ye.getAsteriskToken()) continue;
    if (!isInsideEffectGen(ye)) continue;
    const operand = ye.getExpression();
    if (!operand) continue;
    const k = operand.getKindName();

    // `yield* new Promise(...)`
    if (k === 'NewExpression') {
      const ne = operand.asKindOrThrow(SyntaxKind.NewExpression);
      if (ne.getExpression().getText() === 'Promise') {
        issues.push({
          rule: 'yield-promise',
          message: 'yield* new Promise(...) — Effect.gen requires an Effect, not a Promise; this throws at runtime.',
          severity: 'error',
          location: makeLocation(operand, ctx.filePath),
          suggestion:
            'Wrap the Promise: yield* Effect.promise(() => new Promise(...)) or Effect.tryPromise({ try, catch }).',
        });
        continue;
      }
    }

    // `yield* Promise.all(...)`, `Promise.resolve(...)`, etc., or `yield* fetch(...)`.
    if (k === 'CallExpression') {
      const ce = operand.asKindOrThrow(SyntaxKind.CallExpression);
      const calleeExpr = ce.getExpression();
      const callee = calleeExpr.getText();
      const isPromiseStatic =
        callee === 'Promise.all' ||
        callee === 'Promise.allSettled' ||
        callee === 'Promise.race' ||
        callee === 'Promise.any' ||
        callee === 'Promise.resolve' ||
        callee === 'Promise.reject';
      // For `fetch`, verify the identifier resolves to the GLOBAL fetch — not
      // a local destructure, parameter, or function variable. A symbol with
      // local declarations means it's shadowed; skip to avoid a false-positive
      // "runtime crash" diagnostic on legitimate Effect-returning helpers
      // named `fetch` (common in HTTP-client wrappers like Effect platform).
      let isGlobalFetch = false;
      if (callee === 'fetch' && calleeExpr.getKindName() === 'Identifier') {
        const ident = calleeExpr.asKindOrThrow(SyntaxKind.Identifier);
        const sym = ident.getSymbol();
        if (!sym) {
          isGlobalFetch = true;
        } else {
          const decls = sym.getDeclarations();
          // If none of the declarations are local to a TS source file (or the
          // only declarations are ambient lib.dom.d.ts entries), treat as global.
          const hasLocalDecl = decls.some((d) => {
            const sf2 = d.getSourceFile();
            return !sf2.isDeclarationFile();
          });
          isGlobalFetch = !hasLocalDecl;
        }
      }
      if (isPromiseStatic || isGlobalFetch) {
        issues.push({
          rule: 'yield-promise',
          message: `yield* ${callee}(...) — this returns a Promise, not an Effect; throws at runtime in Effect.gen.`,
          severity: 'error',
          location: makeLocation(operand, ctx.filePath),
          suggestion: isGlobalFetch
            ? 'Use yield* Effect.tryPromise({ try: () => fetch(...), catch: (e) => e }).'
            : `Use yield* Effect.tryPromise({ try: () => ${callee}(...), catch: (e) => e }) or the matching Effect.* combinator.`,
        });
      }
    }
  }
  return issues;
};

// ===========================================================================
// useless-pipe
// ===========================================================================

const checkUselessPipe = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'pipe') continue;
    const args = call.getArguments();
    if (args.length === 1) {
      issues.push({
        rule: 'useless-pipe',
        message: 'pipe(x) with a single argument is a no-op — drop the pipe.',
        severity: 'info',
        location: makeLocation(call, ctx.filePath),
        suggestion: 'Replace pipe(x) with x. Use pipe(x, f, g, ...) only when you actually chain transforms.',
      });
    } else if (args.length === 0) {
      issues.push({
        rule: 'useless-pipe',
        message: 'pipe() with no arguments is a no-op.',
        severity: 'info',
        location: makeLocation(call, ctx.filePath),
        suggestion: 'Remove the empty pipe() call.',
      });
    }
  }
  return issues;
};

// ===========================================================================
// barrel-import-from-effect
// ===========================================================================

/**
 * Mirrors the Effect maintainers' own ESLint rule
 * `@effect/no-import-from-barrel-package` as a deterministic source check.
 * They enforce this across the Effect repo, effect-ts-examples, effect-nextjs,
 * and examples, with packageNames = ["effect", "@effect/platform", "@effect/sql"].
 *
 * Tree-shaking: `import { Effect } from "effect"` pulls the barrel; the
 * recommended form is `import * as Effect from "effect/Effect"` so bundlers
 * can drop unused submodules.
 */

const BARREL_PACKAGES = new Set<string>([
  'effect',
  '@effect/platform',
  '@effect/platform-node',
  '@effect/platform-bun',
  '@effect/platform-browser',
  '@effect/sql',
  '@effect/cluster',
  '@effect/rpc',
]);

/**
 * Test/dtslint files are exempt from the tree-shaking rule — that matches the
 * Effect team's own ESLint config (`packages/*&#47;src/**&#47;*` scope only).
 */
const isTestOrFixtureFile = (filePath: string): boolean =>
  /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx)$/i.test(filePath) ||
  /\.tst\.ts$/i.test(filePath) ||
  /(^|\/)(test|tests|__tests__|integration|dtslint|fixtures?|examples?|scratchpad|test-utils)\//i.test(filePath);

const checkBarrelImportFromEffect = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  // Match the Effect team's own ESLint scope: only `packages/*/src/**/*`.
  // Skip tests, dtslint, fixtures, examples.
  if (isTestOrFixtureFile(ctx.filePath)) return [];
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) {
    // Skip type-only imports — those have no bundling cost.
    if (decl.isTypeOnly()) continue;
    const spec = decl.getModuleSpecifierValue();
    if (!spec || !BARREL_PACKAGES.has(spec)) continue;
    const named = decl.getNamedImports();
    for (const ni of named) {
      if (ni.isTypeOnly()) continue;
      const moduleName = ni.getName();
      const localName = ni.getAliasNode()?.getText() ?? moduleName;
      issues.push({
        rule: 'barrel-import-from-effect',
        message: `import { ${moduleName} } from "${spec}" — barrel imports defeat tree-shaking; the Effect team's own ESLint config flags this.`,
        severity: 'info',
        location: makeLocation(ni, ctx.filePath),
        suggestion: `Replace with: import * as ${localName} from "${spec}/${moduleName}"`,
      });
    }
  }
  return issues;
};

// ===========================================================================
// array-push-spread
// ===========================================================================

/**
 * V8 perf footgun: `arr.push(...xs)` spreads `xs` onto the call stack and can
 * overflow / OOM with large arrays. The Effect team enforces this rule across
 * their codebase via `no-restricted-syntax` and only opts out in a handful of
 * OpenTelemetry batching paths with `// eslint-disable-next-line`.
 *
 * Source: ___temp/repos/effect/eslint.config.mjs:72-78.
 */
const checkArrayPushSpread = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKindName() !== 'PropertyAccessExpression') continue;
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (pa.getName() !== 'push') continue;
    const args = call.getArguments();
    const hasSpread = args.some((a) => a.getKindName() === 'SpreadElement');
    if (!hasSpread) continue;
    issues.push({
      rule: 'array-push-spread',
      message: 'arr.push(...xs) — spreading onto Array#push can stack-overflow on large arrays (V8 footgun; Effect-team enforced).',
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Use a loop (for (const x of xs) arr.push(x)) or arr = arr.concat(xs) for unbounded inputs.',
    });
  }
  return issues;
};

// ===========================================================================
// unsafe-api-usage
// ===========================================================================

/**
 * Flags direct usage of Effect/Runtime unsafe APIs that bypass typed guarantees
 * or runtime safety checks. This is deterministic and source-only; it does not
 * attempt whole-program flow analysis.
 */
const isUnsafeApiCallee = (callee: string): boolean =>
  callee.startsWith('Effect.unsafe') ||
  callee.startsWith('Runtime.unsafe') ||
  callee.includes('.unsafeRun') ||
  callee.includes('.unsafeFork') ||
  callee.includes('.unsafeRunPromise');

const checkUnsafeApiUsage = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (!isUnsafeApiCallee(name)) continue;
    issues.push({
      rule: 'unsafe-api-usage',
      message: `${name}(...) uses an unsafe runtime API; prefer safe constructors/combinators when possible.`,
      severity: 'warning',
      location: makeLocation(call, ctx.filePath),
      suggestion:
        'Use safe Effect APIs (Effect.gen / Effect.scoped / Effect.runPromise) or isolate this call behind a well-reviewed boundary.',
    });
  }
  return issues;
};

// ===========================================================================
// tryPromise-without-catch
// ===========================================================================

/**
 * `Effect.tryPromise(fn)` (short form, no `{ try, catch }` object) collapses
 * thrown errors into `UnknownException` — the typed error channel is lost.
 *
 * The Effect docs recommend the object form for production code:
 *
 *   Effect.tryPromise({
 *     try: () => fetchData(),
 *     catch: (e) => new MyError({ cause: e }),
 *   })
 *
 * Surfaced by real code in effect-start/src/Start.ts. Same applies to
 * `Effect.try(fn)` short form.
 */
const checkTryPromiseWithoutCatch = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  const issues: LintIssue[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = calleeText(call);
    if (name !== 'Effect.tryPromise' && name !== 'Effect.try') continue;
    const args = call.getArguments();
    if (args.length !== 1) continue;
    const first = args[0]!;
    const k = first.getKindName();
    // Object literal form { try, catch } — the recommended shape.
    if (k === 'ObjectLiteralExpression') continue;
    // Anything else (ArrowFunction / FunctionExpression / Identifier referencing a fn)
    // is the short form — flag it.
    issues.push({
      rule: 'tryPromise-without-catch',
      message: `${name}(fn) short form — thrown errors collapse to UnknownException; the typed error channel is lost.`,
      severity: 'info',
      location: makeLocation(call, ctx.filePath),
      suggestion: `Use ${name}({ try: () => ..., catch: (e) => new MyError({ cause: e }) }) to preserve typed errors.`,
    });
  }
  return issues;
};

// ===========================================================================
// Runner
// ===========================================================================

export interface SourceLintResult {
  readonly filePath: string;
  readonly issues: readonly LintIssue[];
}

export const lintSourceFile = (
  sf: SourceFile,
  filePath?: string,
): SourceLintResult => {
  const fp = filePath ?? sf.getFilePath();
  // Skip dtslint type-test files entirely. These intentionally use degenerate
  // runtime patterns (Effect.all({}), Effect.fail(new Error(...))) purely to
  // assert on inferred types via twoslash/dtslint, not as runtime code.
  if (/\.tst\.ts$/i.test(fp)) {
    return { filePath: fp, issues: [] };
  }
  const ctx: SourceLintContext = { filePath: fp };
  const issues: LintIssue[] = [];
  issues.push(...checkUntaggedThrow(sf, ctx));
  issues.push(...checkRawSideEffectInGen(sf, ctx));
  issues.push(...checkMutableInConcurrent(sf, ctx));
  issues.push(...checkRunPromiseThenChain(sf, ctx));
  issues.push(...checkRunSyncOnAsync(sf, ctx));
  issues.push(...checkLiveLayerInTest(sf, ctx));
  issues.push(...checkNondeterministicTestApi(sf, ctx));
  issues.push(...checkDetachedFiberInTest(sf, ctx));
  issues.push(...checkSleepWithoutTestClockInTest(sf, ctx));
  issues.push(...checkConsoleInEffect(sf, ctx));
  issues.push(...checkPromiseApiInGen(sf, ctx));
  issues.push(...checkEffectFailUntagged(sf, ctx));
  issues.push(...checkRunEffectInGen(sf, ctx));
  issues.push(...checkForEachWithoutConcurrency(sf, ctx));
  issues.push(...checkIdentityCatch(sf, ctx));
  issues.push(...checkEmptyEffectAll(sf, ctx));
  issues.push(...checkLayerDuplicateMerge(sf, ctx));
  issues.push(...checkScheduleUnbounded(sf, ctx));
  issues.push(...checkConfigSecretWithoutRedacted(sf, ctx));
  issues.push(...checkReturnEffectFromSync(sf, ctx));
  issues.push(...checkYieldPromise(sf, ctx));
  issues.push(...checkUselessPipe(sf, ctx));
  issues.push(...checkBarrelImportFromEffect(sf, ctx));
  issues.push(...checkArrayPushSpread(sf, ctx));
  issues.push(...checkTryPromiseWithoutCatch(sf, ctx));
  issues.push(...checkUnsafeApiUsage(sf, ctx));

  // Disable pragmas. Build a map keyed by line: lineNumber -> Set<rule|"all">
  // Recognised forms (looked at on the immediately preceding line):
  //   // eslint-disable-next-line <rule>[, <rule>...]
  //   // eslint-disable-next-line  (with no rule → disables all)
  //   // effect-analyzer-disable-next-line <rule>[, ...]
  //   // effect-analyzer-disable-next-line  (no rule → all)
  // Same-line trailing:
  //   // eslint-disable-line <rule>...
  //   // effect-analyzer-disable-line <rule>...
  // For our rule-mapping we also accept `no-restricted-syntax` as an alias
  // for `array-push-spread`, since the Effect codebase uses that ESLint rule
  // name to suppress the same V8 footgun.
  const sourceText = sf.getFullText();
  const lineStarts: number[] = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === '\n') lineStarts.push(i + 1);
  }
  const disablesByLine = new Map<number, Set<string>>();
  const PRAGMA_RE = /\/\/\s*(eslint|effect-analyzer)-disable-(next-line|line)\b([^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = PRAGMA_RE.exec(sourceText)) !== null) {
    const pos = m.index;
    // Compute line containing this comment (1-based).
    let line = 1;
    for (let i = 1; i < lineStarts.length; i++) {
      if (lineStarts[i]! > pos) break;
      line = i + 1;
    }
    const targetLine = m[2] === 'next-line' ? line + 1 : line;
    // Parse rule names after the directive — strip leading punctuation, take
    // the first whitespace-separated token sequence up to a `//` or `/*` or EOL.
    const rest = (m[3] ?? '').replace(/^[\s:,-]+/, '').replace(/\/\*[\s\S]*$/, '').trim();
    const rules = rest === '' ? ['*'] : rest.split(/[\s,]+/).filter(Boolean);
    const set = disablesByLine.get(targetLine) ?? new Set<string>();
    for (const r of rules) set.add(r);
    disablesByLine.set(targetLine, set);
  }
  const RULE_ALIASES: Record<string, string[]> = {
    'array-push-spread': ['no-restricted-syntax'],
  };
  const isSuppressed = (rule: string, line: number | undefined): boolean => {
    if (line === undefined) return false;
    const set = disablesByLine.get(line);
    if (!set) return false;
    if (set.has('*')) return true;
    if (set.has(rule)) return true;
    const aliases = RULE_ALIASES[rule];
    if (aliases?.some((a) => set.has(a))) return true;
    return false;
  };
  const filteredIssues = issues.filter((i) => !isSuppressed(i.rule, i.location?.line));

  const severityRank = (severity: LintIssue['severity']): number => {
    if (severity === 'error') return 0;
    if (severity === 'warning') return 1;
    return 2;
  };
  const canonicalIssues = [...filteredIssues].sort((a, b) => {
    const aPath = a.location?.filePath ?? '';
    const bPath = b.location?.filePath ?? '';
    if (aPath !== bPath) return aPath.localeCompare(bPath);
    const aLine = a.location?.line ?? Number.MAX_SAFE_INTEGER;
    const bLine = b.location?.line ?? Number.MAX_SAFE_INTEGER;
    if (aLine !== bLine) return aLine - bLine;
    const aCol = a.location?.column ?? Number.MAX_SAFE_INTEGER;
    const bCol = b.location?.column ?? Number.MAX_SAFE_INTEGER;
    if (aCol !== bCol) return aCol - bCol;
    if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
    const sevCmp = severityRank(a.severity) - severityRank(b.severity);
    if (sevCmp !== 0) return sevCmp;
    if (a.message !== b.message) return a.message.localeCompare(b.message);
    return (a.suggestion ?? '').localeCompare(b.suggestion ?? '');
  });
  const dedupedIssues: LintIssue[] = [];
  const seen = new Set<string>();
  for (const issue of canonicalIssues) {
    const key = [
      issue.rule,
      issue.severity,
      issue.location?.filePath ?? '',
      String(issue.location?.line ?? ''),
      String(issue.location?.column ?? ''),
      issue.message,
      issue.suggestion ?? '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // Attach docsUrl + Bad/Good example if the rule has registry entries.
    // Per-rule code already populates these explicitly is preserved.
    const docs = RULE_DOCS[issue.rule];
    if (docs && (issue.docsUrl === undefined || issue.example === undefined)) {
      dedupedIssues.push({
        ...issue,
        docsUrl: issue.docsUrl ?? docs.docsUrl,
        example: issue.example ?? docs.example,
      });
    } else {
      dedupedIssues.push(issue);
    }
  }
  return { filePath: fp, issues: dedupedIssues };
};

/**
 * Lint a TypeScript source string. Convenience wrapper for tests/CLI.
 */
export const lintSourceCode = (code: string, filePath = 'temp.ts'): SourceLintResult => {
  const { Project } = loadTsMorph();
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { strict: true, esModuleInterop: true },
  });
  const sf = project.createSourceFile(filePath, code);
  return lintSourceFile(sf, filePath);
};
