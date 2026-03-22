import { describe, it, expect } from 'vitest';
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
import { runCoverageAudit } from './project-analyzer';

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

describe('effect-analyzer (handler/metrics)', () => {
  describe('Object-literal handler analysis', () => {
    it('should analyze Option.match object-literal handlers', async () => {
      const source = [
        'import { Effect, Option } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const opt: Option.Option<number> = Option.some(42);',
        '  const result = Option.match(opt, {',
        '    onNone: () => Effect.succeed("none"),',
        '    onSome: (n) => Effect.succeed(String(n)),',
        '  });',
        '  return yield* result;',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      const json = JSON.stringify(result);
      expect(json).toContain('match');
      const hasUnknown = (n: import('./types').StaticFlowNode): boolean => {
        if (n.type === 'unknown') return true;
        const children = Option.getOrElse(getStaticChildren(n), () => [] as readonly import('./types').StaticFlowNode[]);
        return children.some(hasUnknown);
      };
      expect(hasUnknown(result.root), 'Option.match handler branches should not degrade to unknown').toBe(false);
    });

    it('should analyze Effect.match with effectful branches', async () => {
      const source = [
        'import { Effect } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const eff = Effect.succeed(42);',
        '  return yield* Effect.match(eff, {',
        '    onFailure: (e) => `error: ${e}`,',
        '    onSuccess: (n) => `ok: ${n}`,',
        '  });',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).toContain('"handlerType":"match"');
      const hasUnknown = (n: import('./types').StaticFlowNode): boolean => {
        if (n.type === 'unknown') return true;
        const children = Option.getOrElse(getStaticChildren(n), () => [] as readonly import('./types').StaticFlowNode[]);
        return children.some(hasUnknown);
      };
      expect(hasUnknown(result.root), 'Effect.match handler path should not be unknown').toBe(false);
    });

    it('should not false-positive on arbitrary object literals', async () => {
      const source = [
        'import { Effect } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const config = { onNone: "default", onSome: "custom" };',
        '  return yield* Effect.succeed(config);',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
    });

    it('should analyze Effect.matchEffect with effectful branches', async () => {
      const source = [
        'import { Effect } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const eff = Effect.succeed(42);',
        '  return yield* Effect.matchEffect(eff, {',
        '    onFailure: (e) => Effect.succeed(String(e)),',
        '    onSuccess: (n) => Effect.succeed(n + 1),',
        '  });',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).toContain('matchEffect');
      expect(result.metadata.stats.unknownCount).toBeLessThanOrEqual(2);
    });

    it('should analyze nested Effect.gen inside match handler', async () => {
      const source = [
        'import { Effect } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const eff = Effect.succeed(1);',
        '  return yield* Effect.matchEffect(eff, {',
        '    onFailure: () => Effect.succeed(0),',
        '    onSuccess: () => Effect.gen(function*() { yield* Effect.succeed(2); return 2; }),',
        '  });',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).toContain('generator');
    });

    it('should analyze Match.value with object-literal handlers', async () => {
      const source = [
        'import { Effect, Match } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  const x: number | string = 1;',
        '  return yield* Match.value(x).pipe(',
        '    Match.when({ _tag: "Number" }, (n) => Effect.succeed(n)),',
        '    Match.exhaustive',
        '  );',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).toContain('match');
    });

    it('should analyze Match.tags with effect-returning handlers', async () => {
      const source = [
        'import { Effect, Match } from "effect";',
        'type A = { _tag: "A"; x: number };',
        'type B = { _tag: "B"; y: string };',
        'export const program = Effect.gen(function*() {',
        '  const v: A | B = { _tag: "A", x: 1 };',
        '  return yield* Match.tags(v, {',
        '    A: (a) => Effect.succeed(a.x),',
        '    B: (b) => Effect.succeed(b.y),',
        '  });',
        '});',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).named('program'));
      expect(result.root.children.length).toBeGreaterThan(0);
      const json = JSON.stringify(result);
      expect(json).toContain('match');
    });
  });

  describe('Precision metrics', () => {
    it(
      'should report unknownNodeRate in coverage audit',
      async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'precision-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const filePath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(filePath, [
        'import { Effect } from "effect";',
        'export const program = Effect.gen(function*() {',
        '  yield* Effect.succeed(1);',
        '});',
      ].join('\n'));
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(typeof audit.unknownNodeRate).toBe('number');
        expect(audit.unknownNodeRate).toBeGreaterThanOrEqual(0);
        expect(audit.unknownNodeRate).toBeLessThanOrEqual(1);
        expect(Array.isArray(audit.suspiciousZeros)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    },
      20_000,
    );

    it('should classify files with Effect imports but zero programs as suspicious zeros', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'suspicious-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const suspiciousPath = join(tmp, 'types.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(suspiciousPath, [
        'import { Effect } from "effect";',
        'export type MyEffect = Effect.Effect<number, Error>;',
      ].join('\n'));
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(audit.suspiciousZeros).toContain(suspiciousPath);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should have aggregate audit shape with analyzableCoverage and unknownNodeRate', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'audit-shape-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(appPath, [
        'import { Effect } from "effect";',
        'export const program = Effect.succeed(1);',
      ].join('\n'));
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(typeof audit.discovered).toBe('number');
        expect(typeof audit.analyzed).toBe('number');
        expect(typeof audit.zeroPrograms).toBe('number');
        expect(typeof audit.failed).toBe('number');
        expect(typeof audit.percentage).toBe('number');
        expect(typeof audit.analyzableCoverage).toBe('number');
        expect(typeof audit.unknownNodeRate).toBe('number');
        expect(Array.isArray(audit.suspiciousZeros)).toBe(true);
        expect(audit.discovered).toBeGreaterThanOrEqual(0);
        expect(audit.analyzableCoverage).toBeGreaterThanOrEqual(0);
        expect(audit.analyzableCoverage).toBeLessThanOrEqual(100);
        expect(audit.unknownNodeRate).toBeGreaterThanOrEqual(0);
        expect(audit.unknownNodeRate).toBeLessThanOrEqual(1);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should not include zero-program files without Effect import in suspiciousZeros', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'non-effect-zero-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const noEffectPath = join(tmp, 'utils.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(noEffectPath, [
        'export const add = (a: number, b: number) => a + b;',
      ].join('\n'));
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(audit.suspiciousZeros).not.toContain(noEffectPath);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it(
      'should expose repo-level totalNodes and unknownNodes in audit (improve.md §5)',
      async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'audit-total-unknown-'));
        const tsconfigPath = join(tmp, 'tsconfig.json');
        writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
        writeFileSync(join(tmp, 'app.ts'), [
          'import { Effect } from "effect";',
          'export const program = Effect.succeed(1);',
        ].join('\n'));
        clearProjectCache();
        try {
          const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
          expect(typeof (audit as { totalNodes?: number }).totalNodes).toBe('number');
          expect(typeof (audit as { unknownNodes?: number }).unknownNodes).toBe('number');
          const a = audit as { totalNodes: number; unknownNodes: number; unknownNodeRate: number };
          expect(a.totalNodes).toBeGreaterThanOrEqual(0);
          expect(a.unknownNodes).toBeGreaterThanOrEqual(0);
          if (a.totalNodes > 0) {
            expect(a.unknownNodeRate).toBeCloseTo(a.unknownNodes / a.totalNodes);
          }
        } finally {
          rmSync(tmp, { recursive: true });
          clearProjectCache();
        }
      },
      20_000,
    );
  });

  describe('Acceptance checklist (improve.md)', () => {
    it('alias false-positive: ./stream and ./internal/stream do not match as Effect', async () => {
      await expect(
        Effect.runPromise(analyze.source('import * as stream from "./stream"; const x = stream.map([1], (n) => n + 1);').all()),
      ).rejects.toThrow('No Effect programs found');
      await expect(
        Effect.runPromise(analyze.source('import * as stream from "./internal/stream"; const x = stream.map([1], (n) => n + 1);').all()),
      ).rejects.toThrow('No Effect programs found');
    });

    it('class-member scope: nested and namespace classes do not discover Inner.run', async () => {
      const nested = [
        'import { Effect } from "effect";',
        'const root = Effect.succeed(1);',
        'function f() { class Inner { run() { return Effect.succeed(2); } } return new Inner(); }',
      ].join('\n');
      const ns = [
        'import { Effect } from "effect";',
        'const root = Effect.succeed(1);',
        'namespace N { export class Inner { run() { return Effect.succeed(2); } } }',
      ].join('\n');
      const nestedResults = await Effect.runPromise(analyze.source(nested).all());
      const nsResults = await Effect.runPromise(analyze.source(ns).all());
      expect(nestedResults.map((r) => r.root.programName)).not.toContain('Inner.run');
      expect(nsResults.map((r) => r.root.programName)).not.toContain('Inner.run');
    });

    it('main.ts-style bootstrap is discovered and produces useful IR (pipe + runMain)', async () => {
      const source = [
        'import { Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'const AppLive = Layer.empty;',
        'AppLive.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      const entrypoint = result.find((r) => r.root.source === 'run');
      expect(entrypoint).toBeDefined();
      expect(entrypoint!.root.children.length).toBeGreaterThan(0);
      const pipeChild = entrypoint!.root.children.find((c) => isStaticPipeNode(c));
      expect(pipeChild).toBeDefined();
    });

    it('audit result includes analyzableCoverage and unknownNodeRate for CLI output', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'checklist-audit-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(join(tmp, 'a.ts'), 'import { Effect } from "effect"; export const x = Effect.succeed(1);');
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(typeof audit.analyzableCoverage).toBe('number');
        expect(typeof audit.unknownNodeRate).toBe('number');
        expect(audit.analyzableCoverage).toBeGreaterThanOrEqual(0);
        expect(audit.analyzableCoverage).toBeLessThanOrEqual(100);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  describe('Item 7: Performance – audit duration (improve.md §7)', () => {
    it('audit result includes durationMs for benchmark validation', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'duration-ms-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(join(tmp, 'a.ts'), 'import { Effect } from "effect"; export const x = Effect.succeed(1);');
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(typeof (audit as { durationMs?: number }).durationMs).toBe('number');
        expect((audit as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('optional per-file timing when includePerFileTiming is true', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'perfile-timing-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(join(tmp, 'a.ts'), 'import { Effect } from "effect"; export const x = Effect.succeed(1);');
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(
          runCoverageAudit(tmp, { tsconfig: tsconfigPath, includePerFileTiming: true }),
        );
        expect(audit.outcomes.length).toBeGreaterThan(0);
        for (const o of audit.outcomes) {
          expect(typeof (o as { durationMs?: number }).durationMs).toBe('number');
          expect((o as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  describe('Item 8: Channel/Sink structural analysis (improve.md §8)', () => {
    it('produces StaticChannelNode for Channel.* pipeline', async () => {
      const source = [
        'import { Channel, Effect } from "effect";',
        'export const ch = Channel.succeed(1).pipe(Channel.map((n: number) => n + 1));',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      expect(result.length).toBeGreaterThanOrEqual(1);
      let hasChannel = false;
      const visit = (n: import('./types').StaticFlowNode) => {
        if (isStaticChannelNode(n)) {
          hasChannel = true;
          expect(n.pipeline.length).toBeGreaterThanOrEqual(1);
          expect(n.pipeline.some((p) => p.operation === 'map' || p.operation === 'succeed')).toBe(true);
        }
        const children = Option.getOrElse(getStaticChildren(n), () => []);
        children.forEach(visit);
      };
      for (const r of result) {
        for (const child of r.root.children) visit(child);
      }
      expect(hasChannel).toBe(true);
    });

    it('produces StaticSinkNode for Sink.* pipeline', async () => {
      const source = [
        'import { Sink, Effect } from "effect";',
        'export const sink = Sink.forEach((n: number) => Effect.succeed(undefined));',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      expect(result.length).toBeGreaterThanOrEqual(1);
      let hasSink = false;
      const visit = (n: import('./types').StaticFlowNode) => {
        if (isStaticSinkNode(n)) hasSink = true;
        Option.getOrElse(getStaticChildren(n), () => []).forEach(visit);
      };
      for (const r of result) {
        for (const child of r.root.children) visit(child);
      }
      expect(hasSink).toBe(true);
    });
  });

  describe('Item 9: Runtime family – wrapper bootstrap (improve.md §9)', () => {
    it('analyzes wrapper-bootstrap fixture without throwing', { timeout: 15_000 }, async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'wrapper-bootstrap.ts')).all(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const programNames = result.map((r) => r.root.programName);
      expect(programNames).toContain('program');
    });

    it('discovers wrapper pattern runApp(Layer) as entrypoint', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'wrapper-bootstrap.ts')).all(),
      );
      const programNames = result.map((r) => r.root.programName);
      expect(programNames).toContain('runApp');
      const runAppIr = result.find((r) => r.root.programName === 'runApp');
      expect(runAppIr).toBeDefined();
      expect(runAppIr!.root.source).toBe('run');
      expect(runAppIr!.root.children.length).toBeGreaterThan(0);
    });
  });

  describe('Item 10: CLI – by-folder and json-summary data (improve.md §10)', () => {
    it('audit outcomes support by-folder aggregation', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'by-folder-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['**/*.ts'] }));
      writeFileSync(join(tmp, 'a.ts'), 'import { Effect } from "effect"; export const x = Effect.succeed(1);');
      const bDir = join(tmp, 'b');
      mkdirSync(bDir, { recursive: true });
      writeFileSync(join(bDir, 'b.ts'), 'import { Effect } from "effect"; export const y = Effect.succeed(2);');
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        expect(audit.outcomes.length).toBeGreaterThanOrEqual(2);
        const okCount = audit.outcomes.filter((o) => o.status === 'ok').length;
        expect(okCount).toBeGreaterThanOrEqual(2);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('audit result is JSON-serializable for --json-summary CI mode', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'json-summary-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(join(tmp, 'a.ts'), 'import { Effect } from "effect"; export const x = Effect.succeed(1);');
      clearProjectCache();
      try {
        const audit = await Effect.runPromise(runCoverageAudit(tmp, { tsconfig: tsconfigPath }));
        const json = JSON.stringify({ ...audit, timestamp: new Date().toISOString(), dirPath: tmp });
        const parsed = JSON.parse(json);
        expect(parsed.discovered).toBe(audit.discovered);
        expect(parsed.analyzed).toBe(audit.analyzed);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

});
