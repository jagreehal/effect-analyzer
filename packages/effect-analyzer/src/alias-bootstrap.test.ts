import { describe, it, expect } from 'vitest';
import { Effect, Option } from 'effect';
import { analyze } from './analyze';
import { analyzeFiberLeaks, formatFiberLeakReport } from './fiber-analysis';
import type { StaticEffectNode } from './types';
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
import type { StaticFlowNode } from './types';
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
import { Project } from 'ts-morph';
import { clearProjectCache, createProjectFromSource } from './ts-morph-loader';
import {
  getEffectSubmoduleAliasMap,
  normalizeEffectCallee,
} from './alias-resolution';

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

/** Returns true if the IR tree contains at least one StaticLayerNode. */
function hasLayerNode(node: StaticFlowNode): boolean {
  if (isStaticLayerNode(node)) return true;
  const children = Option.getOrElse(getStaticChildren(node), () => []);
  return children.some((c) => hasLayerNode(c));
}

describe('effect-analyzer (alias/bootstrap)', () => {
  describe('Class member program discovery (Round 35)', () => {
    it('should discover class property with Effect initializer', async () => {
      const source = `
import { Effect } from "effect"

class MyService {
  readonly getValue: Effect.Effect<number> = Effect.succeed(42)
}
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);
      const sources = results.map((ir) => ir.root.source);

      expect(names).toContain('MyService.getValue');
      expect(sources).toContain('classProperty');
    });

    it('should discover class method returning an Effect', async () => {
      const source = `
import { Effect } from "effect"

class MyService {
  run(): Effect.Effect<string> {
    return Effect.succeed("hello")
  }
}
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);
      const sources = results.map((ir) => ir.root.source);

      expect(names).toContain('MyService.run');
      expect(sources).toContain('classMethod');
    });

    it('should discover generator-returning class method', async () => {
      const source = `
import { Effect } from "effect"

class MyService {
  compute() {
    return Effect.gen(function* () {
      yield* Effect.succeed(1)
    })
  }
}
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).toContain('MyService.compute');
    });

    it('should discover both property and method Effect programs (clock pattern)', async () => {
      const source = `
import { Effect } from "effect"

class ClockLike {
  currentTimeMillis = Effect.sync(() => Date.now())

  sleep() {
    return Effect.async<void>(() => undefined)
  }
}
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).toContain('ClockLike.currentTimeMillis');
      expect(names).toContain('ClockLike.sleep');
    });

    it('should not discover class members that are not Effect programs', async () => {
      const source = `
import { Effect } from "effect"

class PlainService {
  getValue(): number { return 42 }
  name = "hello"
}

// Need at least one Effect program for the file to be analyzable
const dummy = Effect.succeed(1)
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).not.toContain('PlainService.getValue');
      expect(names).not.toContain('PlainService.name');
      expect(names).toContain('dummy');
    });
  });

  describe('Alias-aware namespace detection (Round 35)', () => {
    it('should discover programs using aliased core.sync namespace', async () => {
      const source = `
import * as core from "./core"

const myEffect = core.sync(() => 42)
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).toContain('myEffect');
    });

    it('should not treat arbitrary local ./stream namespace imports as Effect aliases', async () => {
      const source = `
import * as stream from "./stream"

const notAnEffect = stream.map([1, 2, 3], (n: number) => n + 1)
`;

      await expect(
        Effect.runPromise(analyze.source(source).all()),
      ).rejects.toThrow('No Effect programs found');
    });

    it('should not treat arbitrary local ./internal/stream namespace imports as Effect aliases', async () => {
      const source = `
import * as stream from "./internal/stream"

const notAnEffect = stream.map([1, 2, 3], (n: number) => n + 1)
`;

      await expect(
        Effect.runPromise(analyze.source(source).all()),
      ).rejects.toThrow('No Effect programs found');
    });

    it('should discover program when namespace alias is from re-export barrel pointing to Effect', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'barrel-reexport-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const barrelPath = join(tmp, 'barrel.ts');
      const mainPath = join(tmp, 'main.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(barrelPath, `export { Effect } from "effect";\n`);
      writeFileSync(mainPath, [
        'import { Effect as E } from "./barrel";',
        'export const program = E.succeed(1);',
      ].join('\n'));
      clearProjectCache();
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results.map((r) => r.root.programName)).toContain('program');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        clearProjectCache();
      }
    });

    it('should discover program with renamed namespace import (import * as E from "effect/Effect")', async () => {
      const source = [
        'import * as E from "effect/Effect";',
        'export const program = E.succeed(42);',
      ].join('\n');
      const results = await Effect.runPromise(analyze.source(source).all());
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.map((r) => r.root.programName)).toContain('program');
    });

    it('should not treat local namespace with map/flatMap as Effect', async () => {
      const source = `
import * as lib from "./lib"

const result = lib.flatMap(lib.map([1,2], (x: number) => x + 1), (x: number) => [x])
`;
      await expect(
        Effect.runPromise(analyze.source(source).all()),
      ).rejects.toThrow('No Effect programs found');
    });

    it('should only discover Effect-like calls in mixed file with Effect and non-Effect namespaces', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'mixed-ns-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const utilsPath = join(tmp, 'utils.ts');
      const mainPath = join(tmp, 'main.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(utilsPath, [
        'export function run(_x: number) { return 0; }',
      ].join('\n'));
      writeFileSync(mainPath, [
        'import * as E from "effect";',
        'import * as Utils from "./utils";',
        'export const program = E.succeed(42);',
        'Utils.run(1);',
      ].join('\n'));
      clearProjectCache();
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        const names = results.map((r) => r.root.programName);
        expect(names).toContain('program');
        expect(names.filter((n) => n.includes('Utils') || n === 'run')).toHaveLength(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
        clearProjectCache();
      }
    });
  });

  describe('Class member discovery scope (failing regressions)', () => {
    it('should not discover class members from nested non-top-level classes', async () => {
      const source = `
import { Effect } from "effect"

const root = Effect.succeed(1)

function makeThing() {
  class Inner {
    run() {
      return Effect.succeed(2)
    }
  }
  return new Inner()
}
`;

      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).toContain('root');
      expect(names).not.toContain('Inner.run');
    });

    it('should not discover class members from namespace-scoped classes', async () => {
      const source = `
import { Effect } from "effect"

const root = Effect.succeed(1)

namespace Internal {
  export class Inner {
    run() {
      return Effect.succeed(2)
    }
  }
}
`;

      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);

      expect(names).toContain('root');
      expect(names).not.toContain('Inner.run');
    });
  });

  // ==========================================================================
  // Round 36: Entrypoint Discovery + Channel/Sink Recognition
  // ==========================================================================

  describe('Entrypoint discovery (Round 36)', () => {
    it('should detect NodeRuntime.runMain as a run program', async () => {
      const source = `
import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
NodeRuntime.runMain(Effect.succeed(42))
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect BunRuntime.runMain as a run program', async () => {
      const source = `
import { Effect } from "effect"
import { BunRuntime } from "@effect/platform-bun"
BunRuntime.runMain(Effect.succeed(42))
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect top-level .pipe() ending in NodeRuntime.runMain', async () => {
      const source = `
import { Effect, Layer } from "effect"
import { NodeRuntime } from "@effect/platform-node"
const HttpLive = Layer.empty
HttpLive.pipe(Layer.launch, NodeRuntime.runMain)
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);
      const hasEntrypoint = names.some(
        (n) => n === 'HttpLive' || n.startsWith('entrypoint-'),
      );
      expect(hasEntrypoint).toBe(true);
    });

    it('should give Channel.* calls a channel semantic description or StaticChannelNode', async () => {
      const source = `
import { Effect, Channel } from "effect"
const program = Effect.gen(function*() {
  yield* Channel.succeed(42)
})
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      expect(results.length).toBeGreaterThanOrEqual(1);
      const effectNodes: import('./types').StaticEffectNode[] = [];
      let hasChannelNode = false;
      const walk = (node: import('./types').StaticFlowNode) => {
        if (node.type === 'effect') effectNodes.push(node as StaticEffectNode);
        if (isStaticChannelNode(node)) hasChannelNode = true;
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      for (const ir of results) {
        ir.root.children.forEach(walk);
      }
      const hasChannelDesc = effectNodes.some((n) => n.description === 'channel');
      expect(hasChannelDesc || hasChannelNode).toBe(true);
    });

    it('should not duplicate programs for assigned run calls vs expression statement scan', async () => {
      const source = `
import { Effect } from "effect"
const result = Effect.runPromise(Effect.succeed(1))
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      expect(results.length).toBe(1);
    });
  });

  // ==========================================================================
  // Symbol-based callee detection
  // ==========================================================================

  describe('Symbol-based callee detection', () => {
    it('should detect Effect.gen via re-export barrel', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'symbol-barrel-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const barrelPath = join(tmp, 'barrel.ts');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(barrelPath, `export { Effect as E } from "effect";`);
      writeFileSync(appPath, [
        'import { E } from "./barrel";',
        'export const program = E.gen(function*() {',
        '  yield* E.succeed(42);',
        '});',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(appPath, { tsConfigPath: tsconfigPath }).named('program'),
        );
        expect(result.root.source).toBe('generator');
        expect(result.root.children.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should detect renamed namespace import from effect submodule', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'symbol-ns-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(appPath, [
        'import * as Fx from "effect/Effect";',
        'export const program = Fx.gen(function*() {',
        '  yield* Fx.succeed(1);',
        '});',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(appPath, { tsConfigPath: tsconfigPath }).named('program'),
        );
        expect(result.root.source).toBe('generator');
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should NOT detect local non-Effect module with same method names', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'symbol-false-pos-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const localLibPath = join(tmp, 'mylib.ts');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(localLibPath, [
        'export function map<T>(arr: T[], fn: (x: T) => T): T[] { return arr.map(fn); }',
        'export function flatMap<T>(arr: T[], fn: (x: T) => T[]): T[] { return arr.flatMap(fn); }',
      ].join('\n'));
      writeFileSync(appPath, [
        'import * as Lib from "./mylib";',
        'export const result = Lib.map([1,2,3], x => x + 1);',
      ].join('\n'));
      clearProjectCache();
      try {
        await expect(
          Effect.runPromise(analyze(appPath, { tsConfigPath: tsconfigPath }).all()),
        ).rejects.toThrow('No Effect programs found');
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should handle mixed Effect and non-Effect namespaces in same file', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'symbol-mixed-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const localLibPath = join(tmp, 'mylib.ts');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(localLibPath, [
        'export function gen(fn: () => void): void { fn(); }',
      ].join('\n'));
      writeFileSync(appPath, [
        'import { Effect } from "effect";',
        'import * as Lib from "./mylib";',
        'export const program = Effect.gen(function*() {',
        '  yield* Effect.succeed(1);',
        '});',
        'Lib.gen(() => console.log("hi"));',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(appPath, { tsConfigPath: tsconfigPath }).all(),
        );
        const names = result.map((r) => r.root.programName);
        expect(names).toContain('program');
        expect(result.length).toBe(1);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  describe('Deep bootstrap analysis', () => {
    it('should produce non-trivial children for .pipe(..., NodeRuntime.runMain)', { timeout: 15_000 }, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'bootstrap-deep-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const mainPath = join(tmp, 'main.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(mainPath, [
        'import { Effect, Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'const HttpLive = Layer.succeed("http", { serve: () => "ok" });',
        'HttpLive.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(result.length).toBeGreaterThan(0);
        const entrypoint = result.find((r) => r.root.source === 'run');
        expect(entrypoint).toBeDefined();
        expect(entrypoint!.root.children.length).toBeGreaterThan(0);
        const pipeChild = entrypoint!.root.children.find((c) => isStaticPipeNode(c));
        if (pipeChild && isStaticPipeNode(pipeChild)) {
          expect(pipeChild.transformations.length).toBeGreaterThan(0);
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should detect .pipe(..., Layer.launch, BunRuntime.runMain)', async () => {
      const source = [
        'import { Layer } from "effect";',
        'import * as BunRuntime from "@effect/platform-bun/BunRuntime";',
        'const AppLive = Layer.empty;',
        'AppLive.pipe(Layer.launch, BunRuntime.runMain);',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      const entrypoint = result.find((r) => r.root.source === 'run');
      expect(entrypoint).toBeDefined();
    });

    it('should produce stable entrypoint names', async () => {
      const source = [
        'import { Effect, Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'const ServerLive = Layer.empty;',
        'ServerLive.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n');
      const first = await Effect.runPromise(analyze.source(source).all());
      const second = await Effect.runPromise(analyze.source(source).all());
      const firstName = first.find((r) => r.root.source === 'run')?.root.programName;
      const secondName = second.find((r) => r.root.source === 'run')?.root.programName;
      expect(firstName).toBe(secondName);
      expect(firstName).toBeDefined();
    });

    it('should not duplicate entrypoint names when multiple pipe entrypoints exist in one file', async () => {
      const source = [
        'import { Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'const A = Layer.empty;',
        'const B = Layer.empty;',
        'A.pipe(Layer.launch, NodeRuntime.runMain);',
        'B.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      const runPrograms = result.filter((r) => r.root.source === 'run');
      const names = runPrograms.map((r) => r.root.programName);
      const uniqueNames = [...new Set(names)];
      expect(uniqueNames.length).toBe(names.length);
      expect(names.length).toBeGreaterThanOrEqual(2);
    });

    it('should include runtime launch stage in pipe transformations', async () => {
      const source = [
        'import { Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'const AppLive = Layer.empty;',
        'AppLive.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n');
      const result = await Effect.runPromise(analyze.source(source).all());
      const entrypoint = result.find((r) => r.root.source === 'run');
      expect(entrypoint).toBeDefined();
      const pipeChild = entrypoint!.root.children.find((c) => isStaticPipeNode(c));
      expect(pipeChild).toBeDefined();
      if (pipeChild && isStaticPipeNode(pipeChild)) {
        const hasRunMain = pipeChild.transformations.some((t) => {
          if (isStaticEffectNode(t)) return t.callee.includes('runMain') || (t.description ?? '').includes('runMain');
          return false;
        });
        expect(hasRunMain).toBe(true);
      }
    });
  });

  describe('Cross-file bootstrap resolution', () => {
    it('should resolve imported layer initializer one level deep', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'crossfile-bootstrap-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const layerPath = join(tmp, 'layer.ts');
      const mainPath = join(tmp, 'main.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(layerPath, [
        'import { Layer, Context } from "effect";',
        'class Database extends Context.Tag("Database")<Database, { query(): string }>() {}',
        'export const DbLive = Layer.succeed(Database, { query: () => "select" });',
      ].join('\n'));
      writeFileSync(mainPath, [
        'import { Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'import { DbLive } from "./layer";',
        'DbLive.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        const entrypoint = result.find((r) => r.root.source === 'run');
        expect(entrypoint).toBeDefined();
        const pipeChild = entrypoint!.root.children.find((c) => isStaticPipeNode(c));
        if (pipeChild && isStaticPipeNode(pipeChild)) {
          expect(isStaticLayerNode(pipeChild.initial) || isStaticEffectNode(pipeChild.initial)).toBe(true);
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should include layer structure from imported initializer in entrypoint analysis', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'crossfile-structure-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const layerPath = join(tmp, 'layer.ts');
      const mainPath = join(tmp, 'main.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(layerPath, [
        'import { Layer, Context } from "effect";',
        'class AppService extends Context.Tag("AppService")<AppService, { run(): string }>() {}',
        'export const AppLayer = Layer.succeed(AppService, { run: () => "ok" });',
      ].join('\n'));
      writeFileSync(mainPath, [
        'import { Layer } from "effect";',
        'import * as NodeRuntime from "@effect/platform-node/NodeRuntime";',
        'import { AppLayer } from "./layer";',
        'AppLayer.pipe(Layer.launch, NodeRuntime.runMain);',
      ].join('\n'));
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        const entrypoint = result.find((r) => r.root.source === 'run');
        expect(entrypoint).toBeDefined();
        const pipeChild = entrypoint!.root.children.find((c) => isStaticPipeNode(c));
        expect(pipeChild).toBeDefined();
        if (pipeChild && isStaticPipeNode(pipeChild)) {
          expect(isStaticLayerNode(pipeChild.initial) || isStaticEffectNode(pipeChild.initial)).toBe(true);
          if (isStaticLayerNode(pipeChild.initial)) {
            expect(pipeChild.initial.provides).toBeDefined();
            expect(pipeChild.initial.provides!.length).toBeGreaterThan(0);
          }
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });
  });

  describe('Indirect runMain wrapper (improve.md §9)', () => {
    it('discovers runApp(Layer) when runApp body contains NodeRuntime.runMain', async () => {
      const source = `
import { Effect, NodeRuntime, Layer } from "effect";

const AppLive = Layer.succeed(Effect.succeed(1));

function runApp(layer: Layer.Layer<never, never>) {
  const program = Effect.gen(function* () {
    yield* layer;
    return 42;
  });
  return NodeRuntime.runMain(program.pipe(Effect.provide(layer)));
}

runApp(AppLive);
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);
      expect(names).toContain('runApp');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Curried runtime (improve.md §9)', () => {
    it('discovers Runtime.runPromise(runtime)(effect) as run entrypoint', async () => {
      const source = `
import { Effect, Runtime } from "effect";

const runtime = Runtime.defaultRuntime;

const program = Effect.succeed(42);
Runtime.runPromise(runtime)(program);
`;
      const results = await Effect.runPromise(analyze.source(source).all());
      const names = results.map((ir) => ir.root.programName);
      expect(names.some((n) => n.startsWith('run-') || n === 'program')).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Cross-file alias context (improve.md §3)', () => {
    const writeStrictTsConfig = (dir: string): string => {
      const tsconfigPath = join(dir, 'tsconfig.json');
      writeFileSync(
        tsconfigPath,
        JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }),
      );
      return tsconfigPath;
    };

    it('resolves L from effect/Layer to Layer in alias map and normalized callee', () => {
      const source = 'import * as L from "effect/Layer";\nexport const x = 1;';
      const sf = createProjectFromSource(source, 'layers.ts');
      const map = getEffectSubmoduleAliasMap(sf);
      expect(map.get('L')).toBe('Layer');
      expect(normalizeEffectCallee('L.succeed', sf)).toBe('Layer.succeed');
    });

    it('getExportedDeclarations includes AppLayer for export const AppLayer', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-export-check-'));
      const layersPath = join(tmp, 'layers.ts');
      writeFileSync(layersPath, `
import * as L from "effect/Layer";
export const AppLayer = L.succeed(null, 1);
`);
      try {
        const project = new Project();
        const sf = project.addSourceFileAtPath(layersPath);
        const exported = sf.getExportedDeclarations();
        expect(exported.has('AppLayer')).toBe(true);
        const decls = exported.get('AppLayer') ?? [];
        expect(decls.length).toBeGreaterThan(0);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('uses resolved file alias context when analyzing imported layer (L from effect/Layer)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-context-'));
      const layersPath = join(tmp, 'layers.ts');
      const mainPath = join(tmp, 'main.ts');
      const tsconfigPath = writeStrictTsConfig(tmp);
      writeFileSync(layersPath, `
import * as L from "effect/Layer";
import { Context } from "effect";

const MyService = Context.GenericTag<"MyService", { id: number }>("MyService");

export const AppLayer = L.succeed(MyService, { id: 42 });
`);
      writeFileSync(mainPath, `
import { NodeRuntime, Layer } from "effect";
import { AppLayer } from "./layers";

AppLayer.pipe(Layer.launch, NodeRuntime.runMain);
`);
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(results.length).toBeGreaterThan(0);
        const ir = results[0];
        if (!ir) return;
        const json = JSON.stringify(ir);
        expect(json).toContain('layer');
        expect(hasLayerNode(ir.root)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('analyzes layer imported through barrel re-export', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-context-barrel-'));
      const layersPath = join(tmp, 'layers.ts');
      const barrelPath = join(tmp, 'barrel.ts');
      const mainPath = join(tmp, 'main.ts');
      const tsconfigPath = writeStrictTsConfig(tmp);
      writeFileSync(layersPath, `
import * as L from "effect/Layer";
import { Context } from "effect";
const MyService = Context.GenericTag<"MyService", { id: number }>("MyService");
export const AppLayer = L.succeed(MyService, { id: 42 });
`);
      writeFileSync(barrelPath, `
export { AppLayer } from "./layers";
`);
      writeFileSync(mainPath, `
import { NodeRuntime, Layer } from "effect";
import { AppLayer } from "./barrel";

AppLayer.pipe(Layer.launch, NodeRuntime.runMain);
`);
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(results.length).toBeGreaterThan(0);
        const ir = results[0];
        if (!ir) return;
        expect(hasLayerNode(ir.root)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('analyzes layer imported as default export', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-context-default-'));
      const layersPath = join(tmp, 'layers.ts');
      const mainPath = join(tmp, 'main.ts');
      const tsconfigPath = writeStrictTsConfig(tmp);
      writeFileSync(layersPath, `
import * as L from "effect/Layer";
import { Context } from "effect";
const MyService = Context.GenericTag<"MyService", { id: number }>("MyService");
const AppLayer = L.succeed(MyService, { id: 42 });
export default AppLayer;
`);
      writeFileSync(mainPath, `
import { NodeRuntime, Layer } from "effect";
import AppLayer from "./layers";

AppLayer.pipe(Layer.launch, NodeRuntime.runMain);
`);
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(results.length).toBeGreaterThan(0);
        const ir = results[0];
        if (!ir) return;
        expect(hasLayerNode(ir.root)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('analyzes aliased named import of a layer', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-context-aliased-'));
      const layersPath = join(tmp, 'layers.ts');
      const mainPath = join(tmp, 'main.ts');
      const tsconfigPath = writeStrictTsConfig(tmp);
      writeFileSync(layersPath, `
import * as L from "effect/Layer";
import { Context } from "effect";
const MyService = Context.GenericTag<"MyService", { id: number }>("MyService");
export const AppLayer = L.succeed(MyService, { id: 42 });
`);
      writeFileSync(mainPath, `
import { NodeRuntime, Layer } from "effect";
import { AppLayer as AL } from "./layers";

AL.pipe(Layer.launch, NodeRuntime.runMain);
`);
      try {
        const results = await Effect.runPromise(
          analyze(mainPath, { tsConfigPath: tsconfigPath }).all(),
        );
        expect(results.length).toBeGreaterThan(0);
        const ir = results[0];
        if (!ir) return;
        expect(hasLayerNode(ir.root)).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('analyzing layers.ts that uses L from effect/Layer yields StaticLayerNode for L.succeed', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'alias-layers-only-'));
      const layersPath = join(tmp, 'layers.ts');
      const layersContent = `
import * as L from "effect/Layer";
import { Context } from "effect";

const MyService = Context.GenericTag<"MyService", { id: number }>("MyService");

export const AppLayer = L.succeed(MyService, { id: 42 });
`;
      writeFileSync(layersPath, layersContent);
      try {
        const results = await Effect.runPromise(analyze(layersPath).all());
        expect(results.length).toBeGreaterThan(0);
        const hasAnyLayer = results.some((ir) => hasLayerNode(ir.root));
        expect(hasAnyLayer).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('analyzing in-memory source with L.succeed yields StaticLayerNode', async () => {
      // Minimal source: only one program so we avoid multi-program ordering issues
      const layersContent = `
import * as L from "effect/Layer";
import { Context } from "effect";
const Tag = Context.GenericTag<"Tag", number>("Tag");
export const AppLayer = L.succeed(Tag, 42);
`;
      const results = await Effect.runPromise(analyze.source(layersContent).all());
      expect(results.length).toBeGreaterThanOrEqual(1);
      const appLayerIr = results.find((ir) => ir.root.programName === 'AppLayer');
      expect(appLayerIr).toBeDefined();
      const root = appLayerIr!.root;
      const children = Option.getOrElse(getStaticChildren(root), () => []);
      expect(children.length).toBeGreaterThanOrEqual(1, `root should have at least one child, got: ${JSON.stringify(children.map((c) => c.type))}`);
      expect(hasLayerNode(root)).toBe(true);
    });
  });

});
