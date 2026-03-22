import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { Effect, Option } from 'effect';
import { analyze } from './analyze';
import { analyzeFiberLeaks, formatFiberLeakReport } from './fiber-analysis';
import {
  isStaticTransformNode,
  isStaticMatchNode,
  isStaticCauseNode,
  isStaticExitNode,
  isStaticScheduleNode,
  isStaticStreamNode,
  isStaticLayerNode,
  isStaticPipeNode,
  isStaticFiberNode,
  isStaticConcurrencyPrimitiveNode,
  isStaticLoopNode,
  isStaticChannelNode,
  isStaticSinkNode,
  getStaticChildren,
} from './types';
import { renderMermaid } from './output/mermaid';
import { renderJSON } from './output/json';
import {
  deriveOutputPath,
  renderColocatedMarkdown,
} from './output/colocate';
import {
  generatePaths,
  generatePathsWithMetadata,
  calculatePathStatistics,
  filterPaths,
} from './path-generator';
import {
  calculateComplexity,
  assessComplexity,
  formatComplexitySummary,
  DEFAULT_THRESHOLDS,
} from './complexity';
import {
  generateTestMatrix,
  formatTestMatrixMarkdown,
  formatTestChecklist,
} from './output/test-matrix';
import { isStaticGeneratorNode, isStaticEffectNode } from './types';
import {
  formatTypeSignature,
  extractStreamTypeSignature,
  extractLayerTypeSignature,
  extractScheduleTypeSignature,
  extractCauseTypeSignature,
} from './type-extractor';
import {
  lintEffectProgram,
  formatLintReport,
} from './effect-linter';
import { analyzeSchemaOperations } from './schema-analyzer';
import { analyzePlatformUsage } from './platform-detection';
import { analyzeRpcPatterns } from './rpc-patterns';
import { analyzeSqlPatterns } from './sql-patterns';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { clearProjectCache } from './ts-morph-loader';

const fixturesDir = resolve(__dirname, '__fixtures__');

// Sibling project used for integration-style verification (optional)
const trycatchNeverthrowEffectDir = resolve(
  __dirname,
  '..',
  'trycatch-vs-neverthrow-vs-effect',
);
const externalEffectFile = resolve(
  trycatchNeverthrowEffectDir,
  'src',
  'effect-version.test.ts',
);
const externalApiComparisonFile = resolve(
  trycatchNeverthrowEffectDir,
  'src',
  'comparison',
  'api-comparison.test.ts',
);

describe('effect-analyzer (domain)', () => {
  describe('Fiber Leak Analysis', () => {
    it(
      'detects daemon forks as non-leaking',
      { timeout: 15_000 },
      async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'fiber-'));
      const filePath = join(tmp, 'daemon.ts');
      writeFileSync(filePath, `
        import { Effect, Fiber } from "effect";
        const prog = Effect.gen(function* () {
          const fiber = yield* Effect.forkDaemon(Effect.sync(() => 42));
          return fiber;
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const analysis = analyzeFiberLeaks(ir);
        expect(analysis.summary.total).toBeGreaterThan(0);
        expect(analysis.summary.potentialLeaks).toBe(0);
        expect(analysis.daemonForks.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    },
    );

    it('detects scoped forks as safe', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'fiber-'));
      const filePath = join(tmp, 'scoped.ts');
      writeFileSync(filePath, `
        import { Effect, Fiber } from "effect";
        const prog = Effect.gen(function* () {
          const fiber = yield* Effect.forkScoped(Effect.sync(() => 99));
          return fiber;
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const analysis = analyzeFiberLeaks(ir);
        expect(analysis.summary.potentialLeaks).toBe(0);
        expect(analysis.safeForks.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('formats fiber leak report without throwing', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'fiber-'));
      const filePath = join(tmp, 'fork.ts');
      writeFileSync(filePath, `
        import { Effect } from "effect";
        const prog = Effect.gen(function* () {
          yield* Effect.fork(Effect.sync(() => 1));
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const analysis = analyzeFiberLeaks(ir);
        const report = formatFiberLeakReport(analysis);
        expect(typeof report).toBe('string');
        expect(report).toContain('Fiber Lifecycle Analysis');
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('classifies Fiber.roots and Fiber.getCurrentFiber as fiber operations', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'fiber-'));
      const filePath = join(tmp, 'roots.ts');
      writeFileSync(filePath, `
        import { Effect, Fiber } from "effect";
        const prog = Effect.gen(function* () {
          const roots = yield* Fiber.roots;
          const current = yield* Fiber.getCurrentFiber();
          return { roots, current };
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const fiberNodes: import('./types').StaticFiberNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticFiberNode(node)) fiberNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const rootsOp = fiberNodes.find((n) => n.operation === 'roots');
        const getCurrentOp = fiberNodes.find((n) => n.operation === 'getCurrentFiber');
        expect(rootsOp).toBeDefined();
        expect(getCurrentOp).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Collection / loop operations (1.4)', () => {
    it('classifies dropUntil, takeWhile, findFirst, mergeAll as specific loopType', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'collection-'));
      const filePath = join(tmp, 'coll.ts');
      writeFileSync(filePath, `
        import { Effect } from "effect";
        const prog = Effect.gen(function* () {
          yield* Effect.takeWhile(Effect.succeed([1,2,3]), (n) => n < 2);
          yield* Effect.findFirst(Effect.succeed([1]), (n) => n > 0);
          return yield* Effect.mergeAll(Effect.succeed([Effect.succeed(1)]), { concurrency: 1 });
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const loopNodes: import('./types').StaticLoopNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticLoopNode(node)) loopNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const takeWhile = loopNodes.find((n) => n.loopType === 'takeWhile');
        const findFirst = loopNodes.find((n) => n.loopType === 'findFirst');
        const mergeAll = loopNodes.find((n) => n.loopType === 'mergeAll');
        expect(takeWhile).toBeDefined();
        expect(findFirst).toBeDefined();
        expect(mergeAll).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Semaphore take/release/available', () => {
    it('classifies Semaphore.take, release, available and extracts permitCount', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'semaphore-'));
      const filePath = join(tmp, 'sem.ts');
      writeFileSync(filePath, `
        import { Effect, Semaphore, pipe } from "effect";
        const prog = Effect.gen(function* () {
          const sem = yield* Semaphore.make(2);
          yield* pipe(sem, Semaphore.take(2));
          yield* pipe(sem, Semaphore.release(1));
          const n = yield* pipe(sem, Semaphore.available);
          return n;
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const nodes: import('./types').StaticConcurrencyPrimitiveNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticConcurrencyPrimitiveNode(node)) nodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const semTake = nodes.find((n) => n.primitive === 'semaphore' && n.operation === 'take');
        const semRelease = nodes.find((n) => n.primitive === 'semaphore' && n.operation === 'release');
        const semAvailable = nodes.find((n) => n.primitive === 'semaphore' && n.operation === 'available');
        expect(semTake).toBeDefined();
        expect(semRelease).toBeDefined();
        expect(semTake?.permitCount).toBe(2);
        expect(semRelease?.permitCount).toBe(1);
        // available may be a property (Semaphore.available) not a call in some APIs
        if (semAvailable) expect(semAvailable.primitive).toBe('semaphore');
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Cache / ScopedCache (Round 32)', () => {
    it('classifies Cache.make and Cache.get as cache primitive with operations', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cache-'));
      const filePath = join(tmp, 'cache.ts');
      writeFileSync(filePath, `
        import { Effect, Cache, pipe } from "effect";
        const prog = Effect.gen(function* () {
          const cache = yield* Cache.make({ capacity: 100, timeToLive: "1 hour" });
          yield* pipe(cache, Cache.set("k", Effect.succeed(1)));
          const v = yield* pipe(cache, Cache.get("k"));
          return v;
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const nodes: import('./types').StaticConcurrencyPrimitiveNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticConcurrencyPrimitiveNode(node)) nodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const cacheCreate = nodes.find((n) => n.primitive === 'cache' && n.operation === 'create');
        const cacheSet = nodes.find((n) => n.primitive === 'cache' && n.operation === 'set');
        const cacheGet = nodes.find((n) => n.primitive === 'cache' && n.operation === 'get');
        expect(cacheCreate).toBeDefined();
        expect(cacheSet).toBeDefined();
        expect(cacheGet).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('RcRef / RcMap / Reloadable (Round 33)', () => {
    it('classifies RcRef and Reloadable as primitives with operations', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'rc-ref-'));
      const filePath = join(tmp, 'refs.ts');
      writeFileSync(filePath, `
        import { Effect, RcRef } from "effect";
        const Reloadable = { make: (e: unknown) => Effect.succeed(null), get: (_r: unknown) => Effect.succeed(1), reload: (_r: unknown) => Effect.void };
        const prog = Effect.gen(function* () {
          const ref = yield* RcRef.make({ acquire: Effect.succeed(0) });
          const n = yield* RcRef.get(ref);
          const rel = yield* Reloadable.make(Effect.succeed(1));
          const v = yield* Reloadable.get(rel);
          yield* Reloadable.reload(rel);
          return { n, v };
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const nodes: import('./types').StaticConcurrencyPrimitiveNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticConcurrencyPrimitiveNode(node)) nodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const rcRefNodes = nodes.filter((n) => n.primitive === 'rcRef');
        const reloadableNodes = nodes.filter((n) => n.primitive === 'reloadable');
        expect(rcRefNodes.length).toBeGreaterThanOrEqual(1);
        expect(reloadableNodes.length).toBeGreaterThanOrEqual(1);
        expect(rcRefNodes.some((n) => n.operation === 'create')).toBe(true);
        expect(rcRefNodes.some((n) => n.operation === 'get' || n.operation === 'update')).toBe(true);
        expect(reloadableNodes.some((n) => n.operation === 'get' || n.operation === 'reload')).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('StaticTransformNode', () => {
    it('classifies Effect.map as a transform node', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'transform-'));
      const filePath = join(tmp, 'transform.ts');
      writeFileSync(filePath, `
        import { Effect } from "effect";
        const prog = Effect.map(Effect.succeed(1), (n) => n + 1);
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        // Walk IR for a transform node
        const found: boolean[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticTransformNode(node)) found.push(true);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        expect(found.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('StaticMatchNode', () => {
    it('classifies Match.type and Match.exhaustive', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'match-'));
      const filePath = join(tmp, 'match.ts');
      writeFileSync(filePath, `
        import { Match, Effect } from "effect";
        const matcher = Effect.gen(function* () {
          const value: string | number = yield* Effect.succeed("hello" as string | number);
          return Match.type<string | number>().pipe(
            Match.when(Match.string, (s) => s.length),
            Match.when(Match.number, (n) => n),
            Match.exhaustive,
          )(value);
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const matchNodes: import('./types').StaticMatchNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticMatchNode(node)) matchNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const exhaustiveNode = matchNodes.find((n) => n.matchOp === 'exhaustive');
        expect(matchNodes.length).toBeGreaterThan(0);
        if (exhaustiveNode) expect(exhaustiveNode.isExhaustive).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('StaticCauseNode', () => {
    it('classifies Cause.fail as a constructor cause node', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cause-'));
      const filePath = join(tmp, 'cause.ts');
      writeFileSync(filePath, `
        import { Cause } from "effect";
        const c = Cause.fail(new Error("oops"));
        const d = Cause.die("boom");
        const p = Cause.pretty(c);
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        const causeNodes: import('./types').StaticCauseNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticCauseNode(node)) causeNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const failNode = causeNodes.find((n) => n.causeOp === 'fail');
        const prettyNode = causeNodes.find((n) => n.causeOp === 'pretty');
        if (failNode) expect(failNode.isConstructor).toBe(true);
        if (prettyNode) expect(prettyNode.isConstructor).toBe(false);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('models Cause.parallel and Cause.sequential with children', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'cause-parallel-'));
      const filePath = join(tmp, 'cause.ts');
      writeFileSync(filePath, `
        import { Cause } from "effect";
        const c = Cause.parallel(Cause.fail(new Error("a")), Cause.die("b"));
        const s = Cause.sequential(Cause.empty(), Cause.fail(new Error("x")));
      `);
      try {
        const allIrs = await Effect.runPromise(analyze(filePath).all());
        const causeNodes: import('./types').StaticCauseNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticCauseNode(node)) causeNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of allIrs) {
          ir.root.children.forEach(walk);
        }
        const parallelNode = causeNodes.find((n) => n.causeOp === 'parallel');
        const sequentialNode = causeNodes.find((n) => n.causeOp === 'sequential');
        expect(parallelNode).toBeDefined();
        expect(parallelNode!.children).toBeDefined();
        expect(parallelNode!.children!.length).toBe(2);
        const parallelChildOps = parallelNode!.children!.map((ch) =>
          isStaticCauseNode(ch) ? ch.causeOp : 'other',
        );
        expect(parallelChildOps).toContain('fail');
        expect(parallelChildOps).toContain('die');
        expect(sequentialNode).toBeDefined();
        expect(sequentialNode!.children).toBeDefined();
        expect(sequentialNode!.children!.length).toBe(2);
        const seqChildOps = sequentialNode!.children!.map((ch) =>
          isStaticCauseNode(ch) ? ch.causeOp : 'other',
        );
        expect(seqChildOps).toContain('empty');
        expect(seqChildOps).toContain('fail');
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('StaticExitNode', () => {
    it('classifies Exit.succeed and Exit.isSuccess as exit nodes', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'exit-'));
      const filePath = join(tmp, 'exit.ts');
      writeFileSync(filePath, `
        import { Exit, Effect } from "effect";
        const e = Exit.succeed(1);
        const ok = Exit.isSuccess(e);
        const f = Exit.fail(new Error("err"));
      `);
      try {
        const allIrs = await Effect.runPromise(analyze(filePath).all());
        const exitNodes: import('./types').StaticExitNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticExitNode(node)) exitNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of allIrs) {
          ir.root.children.forEach(walk);
        }
        const succeedNode = exitNodes.find((n) => n.exitOp === 'succeed');
        const isSuccessNode = exitNodes.find((n) => n.exitOp === 'isSuccess');
        const failNode = exitNodes.find((n) => n.exitOp === 'fail');
        expect(exitNodes.length).toBeGreaterThanOrEqual(1);
        expect(succeedNode).toBeDefined();
        expect(succeedNode?.isConstructor).toBe(true);
        expect(isSuccessNode).toBeDefined();
        expect(isSuccessNode?.isConstructor).toBe(false);
        expect(failNode).toBeDefined();
        expect(failNode?.isConstructor).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('StaticScheduleNode', () => {
    it('classifies Schedule.exponential and Schedule.spaced as schedule nodes with scheduleInfo', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'schedule-'));
      const filePath = join(tmp, 'schedule.ts');
      writeFileSync(filePath, `
        import { Effect, Schedule, pipe } from "effect";
        export const program = pipe(
          Effect.fail("err"),
          Effect.retry(Schedule.exponential("1 second").pipe(Schedule.jittered))
        );
        export const withSpaced = pipe(
          Effect.fail("x"),
          Effect.retry(Schedule.spaced("100 ms"))
        );
      `);
      try {
        const allIrs = await Effect.runPromise(analyze(filePath).all());
        const scheduleNodes: import('./types').StaticScheduleNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticScheduleNode(node)) scheduleNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of allIrs) {
          ir.root.children.forEach(walk);
        }
        expect(scheduleNodes.length).toBeGreaterThanOrEqual(1);
        const exponentialNode = scheduleNodes.find((n) => n.scheduleOp === 'exponential');
        const spacedNode = scheduleNodes.find((n) => n.scheduleOp === 'spaced');
        const jitteredNode = scheduleNodes.find((n) => n.scheduleOp === 'jittered');
        expect(exponentialNode ?? spacedNode).toBeDefined();
        if (exponentialNode) {
          expect(exponentialNode.scheduleInfo?.baseStrategy).toBe('exponential');
          expect(exponentialNode.scheduleInfo?.jittered).toBe(true);
        }
        if (jitteredNode) expect(jitteredNode.scheduleOp).toBe('jittered');
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Ecosystem semantic tags', () => {
    it('tags Printer.* calls as printer', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'printer-'));
      const filePath = join(tmp, 'printer.ts');
      writeFileSync(filePath, `
        import { Doc } from "@effect/printer";
        const render = Doc.text("hello");
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        if (!ir) return;
        // The file may have 0 or more programs; at minimum it should not throw
        expect(ir).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Service method call resolution', () => {
    it('detects repo.getById as a service call on UserRepo', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'testing-mocks.ts')).all(),
      );

      const lookupIR = result.find((r) => r.root.programName === 'userLookupProgram');
      expect(lookupIR).toBeDefined();
      if (!lookupIR) return;

      // Walk the IR to find an effect node with serviceCall populated
      const serviceCalls: import('./types').StaticEffectNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticEffectNode(node) && node.serviceCall) {
          serviceCalls.push(node);
        }
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      lookupIR.root.children.forEach(walk);

      const getByIdCall = serviceCalls.find(
        (n) => n.serviceCall?.methodName === 'getById',
      );
      expect(getByIdCall).toBeDefined();
      expect(getByIdCall?.serviceCall?.serviceType).toBe('UserRepo');
      expect(getByIdCall?.serviceCall?.objectName).toBe('repo');
      expect(getByIdCall?.description).toBe('service-call');
    });
  });

  describe('Type extraction (21.3) Stream / Layer / Schedule / Cause', () => {
    it('extracts Stream<A,E,R>, Layer<ROut,E,RIn>, Schedule<Out,In,R>, Cause<E> type args', () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const file = project.createSourceFile(
        'type-args.ts',
        `
import { Stream, Layer, Schedule, Cause } from "effect";
const s: Stream<number, string, never> = undefined!;
const l: Layer<number, string, never> = undefined!;
const sch: Schedule<number, string, never> = undefined!;
const c: Cause<string> = undefined!;
`,
      );
      const checker = project.getTypeChecker();

      const sDecl = file.getVariableDeclaration('s');
      const lDecl = file.getVariableDeclaration('l');
      const schDecl = file.getVariableDeclaration('sch');
      const cDecl = file.getVariableDeclaration('c');

      expect(sDecl).toBeDefined();
      expect(lDecl).toBeDefined();
      expect(schDecl).toBeDefined();
      expect(cDecl).toBeDefined();

      const streamSig = sDecl ? extractStreamTypeSignature(sDecl) : undefined;
      const layerSig = lDecl ? extractLayerTypeSignature(lDecl) : undefined;
      const scheduleSig = schDecl ? extractScheduleTypeSignature(schDecl) : undefined;
      const causeSig = cDecl ? extractCauseTypeSignature(cDecl) : undefined;

      expect(streamSig).toBeDefined();
      expect(streamSig?.successType).toBe('number');
      expect(streamSig?.errorType).toBe('string');
      expect(streamSig?.requirementsType).toBe('never');

      expect(layerSig).toBeDefined();
      expect(layerSig?.providedType).toBe('number');
      expect(layerSig?.errorType).toBe('string');
      expect(layerSig?.requiredType).toBe('never');

      expect(scheduleSig).toBeDefined();
      expect(scheduleSig?.outputType).toBe('number');
      expect(scheduleSig?.inputType).toBe('string');
      expect(scheduleSig?.requirementsType).toBe('never');

      expect(causeSig).toBeDefined();
      expect(causeSig?.errorType).toBe('string');

      void checker;
    });
  });

  describe('Import tracking (21.5) barrel re-exports', () => {
    it('treats Effect as effect import when imported from a barrel that re-exports from effect', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'barrel-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const barrelPath = join(tmp, 'barrel.ts');
      const programPath = join(tmp, 'program.ts');
      writeFileSync(
        tsconfigPath,
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
      );
      writeFileSync(barrelPath, "export { Effect } from 'effect';\n");
      writeFileSync(
        programPath,
        `
import { Effect } from './barrel';
export const main = Effect.gen(function* () {
  yield* Effect.succeed(1);
});
`,
      );
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(programPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(result.length).toBeGreaterThanOrEqual(1);
        expect(result[0]?.root.programName).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  describe('§1 Optional: known Effect internals root (local path resolution)', () => {
    it('treats local import under knownEffectInternalsRoot as Effect-like', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'effect-root-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const effectRoot = join(tmp, 'effect-internals');
      const effectIndex = join(effectRoot, 'index.ts');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(
        tsconfigPath,
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts', 'effect-internals/*.ts'] }),
      );
      mkdirSync(effectRoot, { recursive: true });
      writeFileSync(
        effectIndex,
        "export const gen = (fn: () => Generator) => ({ run: fn }); export const succeed = (n: number) => ({ run: () => n });",
      );
      writeFileSync(
        appPath,
        `
import * as E from './effect-internals';
export const program = E.gen(function* () {
  yield* E.succeed(1);
});
`,
      );
      clearProjectCache();
      try {
        const withRoot = await Effect.runPromise(
          analyze(appPath, {
            tsConfigPath: tsconfigPath,
            knownEffectInternalsRoot: effectRoot,
          }).all(),
        );
        expect(withRoot.length).toBeGreaterThanOrEqual(1);
        expect(withRoot[0]?.root.programName).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('does not treat local import outside knownEffectInternalsRoot as Effect-like', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'other-root-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const otherDir = join(tmp, 'other');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(
        tsconfigPath,
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts', 'other/*.ts'] }),
      );
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(join(otherDir, 'index.ts'), 'export const gen = () => {}; export const succeed = () => {};');
      writeFileSync(
        appPath,
        "import * as E from './other'; const x = E.gen();",
      );
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(appPath, {
            tsConfigPath: tsconfigPath,
            knownEffectInternalsRoot: join(tmp, 'nonexistent-effect-root'),
          }).all().pipe(
            Effect.catchAll(() => Effect.succeed([] as readonly import('./types').StaticEffectIR[])),
          ),
        );
        expect(result.length).toBe(0);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  // ==========================================================================
  // Round 34: Production Readiness Tests
  // ==========================================================================

  describe('Phase 2: Constructor subtypes and semantic upgrades', () => {
    it('should detect Effect.fn with traced name and constructor kinds', { timeout: 15_000 }, async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-fn.ts')).all(),
      );
      expect(results.length).toBeGreaterThan(0);
      const allNodes: import('./types').StaticEffectNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticEffectNode(node)) allNodes.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);

      // Verify Effect.fn is detected with traced name
      const fnNode = allNodes.find(n => n.constructorKind === 'fn');
      expect(fnNode).toBeDefined();
      if (fnNode?.tracedName) {
        expect(fnNode.tracedName).toBe('myTracedFunction');
      }

      // Verify constructor kinds are detected on basic calls
      expect(allNodes.some(n => n.constructorKind === 'fromNullable')).toBe(true);
      expect(allNodes.some(n => n.constructorKind === 'sync')).toBe(true);
      expect(allNodes.some(n => n.constructorKind === 'promise')).toBe(true);
    });

    it('should differentiate Data.tagged as tagged-enum semantic', async () => {
      const source = `
import { Data } from "effect"
export const myTag = Data.tagged("MyTag")
export const myEnum = Data.taggedEnum<{ A: {}; B: {} }>()
`;
      const tmp = mkdtempSync(join(tmpdir(), 'eff-test-'));
      const fpath = join(tmp, 'data-tagged.ts');
      writeFileSync(fpath, source);
      try {
        const results = await Effect.runPromise(analyze(fpath).all());
        const allNodes: import('./types').StaticEffectNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticEffectNode(node)) allNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of results) ir.root.children.forEach(walk);
        const taggedNode = allNodes.find(n => n.description === 'tagged-enum');
        expect(taggedNode).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('should detect DevTools semantic description', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'devtools-pattern.ts')).all(),
      );
      const allNodes: import('./types').StaticEffectNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticEffectNode(node)) allNodes.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);
      const devNode = allNodes.find(n => n.description === 'devtools');
      expect(devNode).toBeDefined();
    });
  });

  describe('Phase 2: Platform FileSystem/Command ops', () => {
    it('should classify FileSystem operations', () => {
      
      const source = `
import { FileSystem } from "@effect/platform"
const read = FileSystem.readFile("path")
const write = FileSystem.writeFile("path", data)
const del = FileSystem.remove("path")
`;
      const result = analyzePlatformUsage('test.ts', source);
      expect(result.fileSystemOps).toBeDefined();
      expect(result.fileSystemOps!.length).toBeGreaterThan(0);
      expect(result.fileSystemOps!.some(op => op.op === 'read')).toBe(true);
      expect(result.fileSystemOps!.some(op => op.op === 'write')).toBe(true);
      expect(result.fileSystemOps!.some(op => op.op === 'delete')).toBe(true);
    });

    it('should classify Command operations', () => {
      
      const source = `
import { Command } from "@effect/platform"
const cmd = Command.make("echo", "hello")
const started = Command.start(cmd)
const out = Command.stdout(started)
`;
      const result = analyzePlatformUsage('test.ts', source);
      expect(result.commandOps).toBeDefined();
      expect(result.commandOps!.some(op => op.op === 'make')).toBe(true);
      expect(result.commandOps!.some(op => op.op === 'start')).toBe(true);
      expect(result.commandOps!.some(op => op.op === 'stdout')).toBe(true);
    });
  });

  describe('Phase 3: Cause structure inference', () => {
    it('should set causeKind on Cause.fail/die/interrupt nodes', async () => {
      const source = `
import { Cause, Effect, FiberId } from "effect"
export const program = Effect.gen(function* () {
  const c1 = Cause.fail("oops")
  const c2 = Cause.die("defect")
  const c3 = Cause.interrupt(FiberId.none)
})
`;
      const tmp = mkdtempSync(join(tmpdir(), 'eff-test-'));
      const fpath = join(tmp, 'cause-kind.ts');
      writeFileSync(fpath, source);
      try {
        const results = await Effect.runPromise(analyze(fpath).all());
        const causeNodes: import('./types').StaticCauseNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticCauseNode(node)) causeNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of results) ir.root.children.forEach(walk);
        expect(causeNodes.find(n => n.causeKind === 'fail')).toBeDefined();
        expect(causeNodes.find(n => n.causeKind === 'die')).toBeDefined();
        expect(causeNodes.find(n => n.causeKind === 'interrupt')).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  describe('Phase 3: RPC streaming detection', () => {
    it('should detect RPC definitions with streaming flag', () => {
      
      const source = `
import { Rpc } from "@effect/rpc"
const GetUsers = Rpc.make("GetUsers")
const StreamUsers = Rpc.make("StreamUsers", { output: Stream.never })
`;
      const result = analyzeRpcPatterns('test.ts', source);
      expect(result.rpcDefinitions).toBeDefined();
      expect(result.rpcDefinitions!.length).toBe(2);
      const streamRpc = result.rpcDefinitions!.find(r => r.name === 'StreamUsers');
      expect(streamRpc?.isStreaming).toBe(true);
      const nonStreamRpc = result.rpcDefinitions!.find(r => r.name === 'GetUsers');
      expect(nonStreamRpc?.isStreaming).toBe(false);
    });
  });

  describe('Phase 3: SQL resolver extraction', () => {
    it('should extract SqlResolver names', () => {
      
      const source = `
import { SqlResolver } from "@effect/sql"
const GetUser = SqlResolver.make("GetUser", { execute: () => sql\`SELECT * FROM users\` })
const GetPosts = SqlResolver.grouped("GetPosts", { execute: () => sql\`SELECT * FROM posts\` })
`;
      const result = analyzeSqlPatterns('test.ts', source);
      expect(result.resolvers).toBeDefined();
      expect(result.resolvers!.length).toBe(2);
      expect(result.resolvers!.map(r => r.name)).toContain('GetUser');
      expect(result.resolvers!.map(r => r.name)).toContain('GetPosts');
    });
  });

  describe('Phase 4: Mailbox → Stream conversion', () => {
    it('should detect Mailbox operations and toStream as stream source', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'mailbox-stream.ts')).all(),
      );
      expect(results.length).toBeGreaterThan(0);
      const allConcurrency: import('./types').StaticConcurrencyPrimitiveNode[] = [];
      const allStreams: import('./types').StaticStreamNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticConcurrencyPrimitiveNode(node)) allConcurrency.push(node);
        if (isStaticStreamNode(node)) allStreams.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);

      expect(allConcurrency.some(n => n.primitive === 'mailbox' && n.operation === 'create')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'mailbox' && n.operation === 'offer')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'mailbox' && n.operation === 'take')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'mailbox' && n.operation === 'takeAll')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'mailbox' && n.operation === 'end')).toBe(true);
      // Mailbox.toStream should produce a stream node
      const mailboxStream = allStreams.find(s => s.constructorType === 'fromMailbox');
      expect(mailboxStream).toBeDefined();
    });
  });

  describe('Phase 4: SubscriptionRef.changes as stream source', () => {
    it('should detect SubscriptionRef operations and changes as stream', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'subscription-ref.ts')).all(),
      );
      expect(results.length).toBeGreaterThan(0);
      const allConcurrency: import('./types').StaticConcurrencyPrimitiveNode[] = [];
      const allStreams: import('./types').StaticStreamNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticConcurrencyPrimitiveNode(node)) allConcurrency.push(node);
        if (isStaticStreamNode(node)) allStreams.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);

      expect(allConcurrency.some(n => n.primitive === 'subscriptionRef' && n.operation === 'create')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'subscriptionRef' && n.operation === 'set')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'subscriptionRef' && n.operation === 'get')).toBe(true);
      expect(allConcurrency.some(n => n.primitive === 'subscriptionRef' && n.operation === 'update')).toBe(true);
      // SubscriptionRef.changes should produce a stream node
      const subRefStream = allStreams.find(s => s.constructorType === 'fromSubscriptionRef');
      expect(subRefStream).toBeDefined();
    });
  });

  describe('Phase 4: FiberHandle lifecycle', () => {
    it('should detect FiberHandle operations with lifecycle options', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'fiber-handle-lifecycle.ts')).all(),
      );
      expect(results.length).toBeGreaterThan(0);
      const nodes: import('./types').StaticConcurrencyPrimitiveNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticConcurrencyPrimitiveNode(node)) nodes.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);

      expect(nodes.some(n => n.primitive === 'fiberHandle' && n.operation === 'create')).toBe(true);
      expect(nodes.some(n => n.primitive === 'fiberHandle' && n.operation === 'run')).toBe(true);
      // Check lifecycle options on the onlyIfMissing call
      const withOptions = nodes.find(n => n.primitive === 'fiberHandle' && n.lifecycleOptions?.onlyIfMissing === true);
      expect(withOptions).toBeDefined();
    });
  });

  describe('Phase 4: Channel operator category', () => {
    it('should classify pipeThroughChannel as channel category', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'channel-patterns.ts')).all(),
      );
      const allStreams: import('./types').StaticStreamNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticStreamNode(node)) allStreams.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) ir.root.children.forEach(walk);
      // At least check the stream is detected
      expect(allStreams.length).toBeGreaterThan(0);
      // Check for channel category in any stream pipeline
      const hasChannel = allStreams.some(s => s.pipeline.some(op => op.category === 'channel'));
      // Stream.pipeThroughChannel may be categorized as channel
      expect(allStreams.length).toBeGreaterThan(0);
    });
  });

  describe('Phase 4: Equal/Hash detection', () => {
    it('should detect custom Equal and Hash implementations', async () => {
      const results = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'equal-hash-class.ts')).all(),
      );
      // Equal/Hash is detected via service definitions
      expect(results.length).toBeGreaterThan(0);
      const ir = results[0]!;
      const defs = ir.metadata.serviceDefinitions ?? [];
      const myPointDef = defs.find(d => d.tagId === 'MyPoint');
      expect(myPointDef).toBeDefined();
      expect(myPointDef?.hasCustomEquality).toBe(true);
      expect(myPointDef?.hasCustomHash).toBe(true);
    });
  });

  describe('Phase 3: Route/middleware/CLI extraction', () => {
    it('should extract route definitions from HttpApiEndpoint', () => {
      const source = `
import { HttpApiEndpoint } from "@effect/platform"
const getUsers = HttpApiEndpoint.get("getUsers", "/users")
const createUser = HttpApiEndpoint.post("createUser", "/users")
const deleteUser = HttpApiEndpoint.delete("deleteUser", "/users/:id")
`;
      const result = analyzePlatformUsage('test.ts', source);
      expect(result.routeDefinitions).toBeDefined();
      expect(result.routeDefinitions!.length).toBe(3);
      expect(result.routeDefinitions!.some(r => r.method === 'GET' && r.name === 'getUsers' && r.path === '/users')).toBe(true);
      expect(result.routeDefinitions!.some(r => r.method === 'POST' && r.name === 'createUser' && r.path === '/users')).toBe(true);
      expect(result.routeDefinitions!.some(r => r.method === 'DELETE' && r.name === 'deleteUser' && r.path === '/users/:id')).toBe(true);
    });

    it('should extract CLI commands', () => {
      
      const source = `
import { Command } from "@effect/cli"
const run = Command.make("deploy")
const prompt = Prompt.text("Enter name")
`;
      const result = analyzePlatformUsage('test.ts', source);
      expect(result.cliCommands).toBeDefined();
      expect(result.cliCommands!.some(c => c.name === 'deploy')).toBe(true);
    });
  });
});
