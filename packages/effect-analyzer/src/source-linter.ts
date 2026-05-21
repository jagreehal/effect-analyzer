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
    if (name === 'Error' || name === 'TypeError' || name === 'RangeError') {
      // Only flag when the throw is inside Effect-context (gen/sync/try)
      if (
        isInsideEffectGen(stmt) ||
        isInsideEffectSyncOrTry(stmt)
      ) {
        issues.push({
          rule: 'untagged-throw',
          message: `throw new ${name}(...) inside Effect context — use Data.TaggedError or Effect.fail with a tagged error.`,
          severity: 'warning',
          location: makeLocation(stmt, ctx.filePath),
          suggestion:
            'Define a Data.TaggedError class and either throw it or use Effect.fail(new MyError({...})).',
        });
      }
    }
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
        'Use Effect.map / Effect.flatMap / Effect.catchAll BEFORE runPromise. If you must escape, do it at the entry point.',
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
  // with Effect.promise / Effect.tryPromise / Effect.async* / Effect.sleep.
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

const checkLiveLayerInTest = (
  sf: SourceFile,
  ctx: SourceLintContext,
): LintIssue[] => {
  const { SyntaxKind } = loadTsMorph();
  if (!TEST_FILE_PATTERN.test(ctx.filePath)) return [];
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    if (!name.endsWith("Live")) continue;
    if (name === 'Live') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    issues.push({
      rule: 'live-layer-in-test',
      message: `Test file references "${name}" — a Live layer should not be wired into tests.`,
      severity: 'warning',
      location: makeLocation(id, ctx.filePath),
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
  if (!TEST_FILE_PATTERN.test(ctx.filePath)) return [];
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
  if (!TEST_FILE_PATTERN.test(ctx.filePath)) return [];
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
  const canonicalIssues = [...issues].sort((a, b) => {
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
    if (a.severity !== b.severity) return a.severity.localeCompare(b.severity);
    if (a.message !== b.message) return a.message.localeCompare(b.message);
    return (a.suggestion ?? '').localeCompare(b.suggestion ?? '');
  });
  return { filePath: fp, issues: canonicalIssues };
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
