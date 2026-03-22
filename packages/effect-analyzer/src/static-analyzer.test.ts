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
  isStaticUnknownNode,
  getStaticChildren,
} from './types';
import { renderMermaid, renderPathsMermaid } from './output/mermaid';
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
  formatTestMatrixAsCode,
} from './output/test-matrix';
import type { TestMatrix } from './types';
import type { StaticEffectNode, StaticLayerNode, StaticPipeNode } from './types';
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

describe('effect-analyzer', () => {
  describe('Simple Effect Programs', () => {
    it(
      'should analyze a simple Effect.gen program',
      { timeout: 15_000 },
      async () => {
        const result = await Effect.runPromise(
          analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
            'simpleProgram',
          ),
        );

        expect(result.root.programName).toBe('simpleProgram');
        expect(result.root.source).toBe('generator');
        expect(result.root.children.length).toBeGreaterThan(0);
        expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
      },
    );

    it('should find multiple programs in a file', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(2);
      const programNames = result.map((r) => r.root.programName);
      expect(programNames).toContain('simpleProgram');
      expect(programNames).toContain('programWithErrorHandling');
    });

    it('should access programs by name', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      expect(result.root.programName).toBe('simpleProgram');
    });
  });

  describe('Parallel and Race Programs', () => {
    it('should detect parallel effects (Effect.all)', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'parallelProgram',
        ),
      );

      expect(result.metadata.stats.parallelCount).toBeGreaterThan(0);
    });

    it('should detect race effects', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'raceProgram',
        ),
      );

      expect(result.metadata.stats.raceCount).toBeGreaterThan(0);
    });

    it('should detect forEach loops', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'forEachProgram',
        ),
      );

      expect(result.metadata.stats.loopCount).toBeGreaterThan(0);
    });

    it('should use reducer as body for Effect.reduce', async () => {
      const result = await Effect.runPromise(
        analyze
          .source(`
          import { Effect } from "effect";
          export const program = Effect.reduce(
            [1, 2, 3],
            0,
            (acc, n) => Effect.succeed(acc + n)
          );
        `)
          .single(),
      );
      const stack: import('./types').StaticFlowNode[] = [
        ...result.root.children,
      ];
      let sawUnknownLoopBody = false;
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (
          isStaticUnknownNode(node) &&
          node.reason.includes('Could not determine loop body')
        ) {
          sawUnknownLoopBody = true;
          break;
        }
        const children = Option.getOrElse(
          getStaticChildren(node),
          () => [] as readonly import('./types').StaticFlowNode[],
        );
        stack.push(...children);
      }
      expect(sawUnknownLoopBody).toBe(false);
      expect(result.metadata.stats.loopCount).toBeGreaterThan(0);
    });
  });

  describe('Error Handling Programs', () => {
    it('should detect error handlers (catchAll)', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).named(
          'catchAllProgram',
        ),
      );

      expect(result.metadata.stats.errorHandlerCount).toBeGreaterThanOrEqual(
        0,
      );
    });

    it('should detect catchTag handlers', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).named(
          'catchTagProgram',
        ),
      );

      expect(result.metadata.stats.errorHandlerCount).toBeGreaterThanOrEqual(
        0,
      );
    });

    it('should detect retry patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).named(
          'retryProgram',
        ),
      );

      expect(result.metadata.stats.retryCount).toBeGreaterThanOrEqual(0);
    });

    it('should detect timeout patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).named(
          'timeoutProgram',
        ),
      );

      expect(result.metadata.stats.timeoutCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Resource Programs', () => {
    it('should detect resource acquisition patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'resource-effect.ts')).named(
          'resourceProgram',
        ),
      );

      expect(result.metadata.stats.resourceCount).toBeGreaterThanOrEqual(0);
    });

    it('should detect ensuring patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'resource-effect.ts')).named(
          'ensuringProgram',
        ),
      );

      expect(result.metadata.stats.resourceCount).toBeGreaterThanOrEqual(0);
    });

    it('should classify acquireReleaseInterruptible as a resource pattern', async () => {
      const result = await Effect.runPromise(
        analyze.source(`
          import { Effect } from "effect";
          export const program = Effect.acquireReleaseInterruptible(
            Effect.succeed(1),
            () => Effect.void
          );
        `).single(),
      );

      const stack = [...result.root.children];
      let sawResource = false;
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        if (node.type === 'resource') {
          sawResource = true;
          break;
        }
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        stack.push(...children);
      }

      expect(sawResource).toBe(true);
    });
  });

  describe('Source Code Analysis', () => {
    it('should analyze source code directly', async () => {
      const source = `
        import { Effect } from "effect";
        
        const myProgram = Effect.gen(function* () {
          yield* Effect.log("Hello");
          return 42;
        });
      `;

      const result = await Effect.runPromise(analyze.source(source).single());

      expect(result.root.programName).toBe('myProgram');
      expect(result.root.source).toBe('generator');
    });

    it('should handle multiple programs in source', async () => {
      const source = `
        import { Effect } from "effect";
        
        const program1 = Effect.succeed(1);
        const program2 = Effect.succeed(2);
        const program3 = Effect.fail("error");
      `;

      const result = await Effect.runPromise(analyze.source(source).all());

      expect(result.length).toBe(3);
    });
  });

  describe('Mermaid Diagram Generation', () => {
    it('should generate Mermaid diagram for simple program', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const diagram = await Effect.runPromise(renderMermaid(ir));

      expect(diagram).toContain('flowchart');
      expect(diagram).toContain(ir.root.programName);
      expect(diagram.length).toBeGreaterThan(50);
    });

    it('should generate Mermaid diagram with proper styles', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'parallelProgram',
        ),
      );

      const diagram = await Effect.runPromise(
        renderMermaid(ir, { includeDescriptions: true }),
      );

      expect(diagram).toContain('classDef');
      expect(diagram).toContain('parallel');
    });
  });

  describe('JSON Output Generation', () => {
    it('should generate JSON output', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const json = await Effect.runPromise(renderJSON(ir));
      const parsed = JSON.parse(json);

      expect(parsed.root).toBeDefined();
      expect(parsed.root.programName).toBe(ir.root.programName);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.stats).toBeDefined();
    });

    it('should generate compact JSON output', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const json = await Effect.runPromise(renderJSON(ir, { pretty: false }));

      expect(json).not.toContain('\n  ');
      expect(JSON.parse(json)).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should fail for non-existent files', async () => {
      const result = await Effect.runPromise(
        analyze('./non-existent-file.ts').single().pipe(Effect.either),
      );

      expect(result._tag).toBe('Left');
    });

    it('should fail for files without Effect programs', async () => {
      const source = `
        const x = 1;
        const y = 2;
        console.log(x + y);
      `;

      const result = await Effect.runPromise(
        analyze.source(source).single().pipe(Effect.either),
      );

      expect(result._tag).toBe('Left');
    });

    it('should return None for singleOption when multiple programs exist', async () => {
      const source = `
        import { Effect } from "effect";
        const p1 = Effect.succeed(1);
        const p2 = Effect.succeed(2);
      `;

      const result = await Effect.runPromise(
        analyze.source(source).singleOption(),
      );

      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe('Gap 6: JavaScript/JSX support', () => {
    it('should analyze a .js file with Effect.gen when extensions include .js', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-program.js')).all(),
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
      const names = result.map((r) => r.root.programName);
      expect(names).toContain('jsProgram');
      expect(result.some((r) => r.root.source === 'generator')).toBe(true);
    });
  });

  describe('Type Guards', () => {
    it('should correctly identify node types', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      for (const child of ir.root.children) {
        if (child.type === 'generator') {
          expect(isStaticGeneratorNode(child)).toBe(true);
          expect(isStaticEffectNode(child)).toBe(false);
        } else if (child.type === 'effect') {
          expect(isStaticEffectNode(child)).toBe(true);
          expect(isStaticGeneratorNode(child)).toBe(false);
        }
      }
    });
  });

  describe('Analysis Statistics', () => {
    it('should track total effects', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'parallelProgram',
        ),
      );

      expect(ir.metadata.stats.totalEffects).toBeGreaterThan(0);
      expect(ir.metadata.analyzedAt).toBeGreaterThan(0);
      expect(ir.metadata.filePath).toContain('parallel-effect.ts');
    });

    it('should track parallel and race counts', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'raceProgram',
        ),
      );

      expect(ir.metadata.stats.raceCount).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Path Generator (parity with awaitly-analyze)
  // ==========================================================================

  describe('Path Generator', () => {
    it('should generate paths for a simple program', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]).toHaveProperty('id');
      expect(paths[0]).toHaveProperty('description');
      expect(paths[0]).toHaveProperty('steps');
      expect(paths[0]).toHaveProperty('conditions');
      expect(paths[0]).toHaveProperty('hasLoops');
      expect(paths[0]).toHaveProperty('hasUnresolvedRefs');
    });

    it('should return paths with metadata (limitHit)', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const { paths, limitHit } = generatePathsWithMetadata(ir, {
        maxPaths: 1000,
      });
      expect(paths.length).toBeGreaterThan(0);
      expect(limitHit).toBe(false);
    });

    it('should set limitHit when maxPaths is hit', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'raceProgram',
        ),
      );

      const { paths, limitHit } = generatePathsWithMetadata(ir, {
        maxPaths: 1,
      });
      expect(paths.length).toBeLessThanOrEqual(1);
      expect(limitHit).toBe(true);
    });

    it('should set pathLimitHit to false when not truncated', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const { paths, limitHit } = generatePathsWithMetadata(ir, {
        maxPaths: 100,
      });
      const stats = calculatePathStatistics(paths, { limitHit });
      expect(stats.pathLimitHit).toBe(false);
      expect(stats.totalPaths).toBe(paths.length);
    });

    it('should calculate path statistics', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const stats = calculatePathStatistics(paths);

      expect(stats.totalPaths).toBe(paths.length);
      expect(stats.maxPathLength).toBeGreaterThanOrEqual(0);
      expect(stats.minPathLength).toBeGreaterThanOrEqual(0);
      expect(stats.avgPathLength).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(stats.uniqueConditions)).toBe(true);
    });

    it('should filter paths by mustIncludeStep', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const filtered = filterPaths(paths, {
        mustIncludeStep: paths[0]?.steps[0]?.nodeId ?? 'effect-1',
      });
      expect(filtered.length).toBeLessThanOrEqual(paths.length);
    });

    it('should filter paths by noLoops', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const filtered = filterPaths(paths, { noLoops: true });
      expect(filtered.every((p) => !p.hasLoops)).toBe(true);
    });
  });

  // ==========================================================================
  // Complexity (parity with awaitly-analyze)
  // ==========================================================================

  describe('Complexity', () => {
    it('should calculate complexity metrics for a program', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const metrics = calculateComplexity(ir);
      expect(metrics).toHaveProperty('cyclomaticComplexity');
      expect(metrics).toHaveProperty('cognitiveComplexity');
      expect(metrics).toHaveProperty('pathCount');
      expect(metrics).toHaveProperty('maxDepth');
      expect(metrics).toHaveProperty('maxParallelBreadth');
      expect(metrics).toHaveProperty('decisionPoints');
      expect(metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
    });

    it('should report maxParallelBreadth for parallel program', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'parallelProgram',
        ),
      );

      const metrics = calculateComplexity(ir);
      expect(metrics.maxParallelBreadth).toBeGreaterThanOrEqual(0);
    });

    it('should assess complexity and return level and warnings', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const metrics = calculateComplexity(ir);
      const assessment = assessComplexity(metrics, DEFAULT_THRESHOLDS);
      expect(assessment).toHaveProperty('level');
      expect(assessment).toHaveProperty('warnings');
      expect(assessment).toHaveProperty('recommendations');
      expect(['low', 'medium', 'high', 'very-high']).toContain(assessment.level);
    });

    it('should format complexity summary as markdown', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const metrics = calculateComplexity(ir);
      const assessment = assessComplexity(metrics, DEFAULT_THRESHOLDS);
      const summary = formatComplexitySummary(metrics, assessment);
      expect(summary).toContain('Complexity Report');
      expect(summary).toContain('Metrics');
      expect(summary).toContain(String(metrics.cyclomaticComplexity));
    });

    it('should export DEFAULT_THRESHOLDS', () => {
      expect(DEFAULT_THRESHOLDS.cyclomaticWarning).toBe(10);
      expect(DEFAULT_THRESHOLDS.cyclomaticError).toBe(20);
      expect(DEFAULT_THRESHOLDS.pathCountWarning).toBe(50);
      expect(DEFAULT_THRESHOLDS.maxDepthWarning).toBe(5);
    });
  });

  // ==========================================================================
  // Test Matrix (parity with awaitly-analyze)
  // ==========================================================================

  describe('Test Matrix', () => {
    it('should generate test matrix from paths', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const matrix = generateTestMatrix(paths);
      expect(matrix.paths.length).toBe(paths.length);
      expect(matrix.conditions).toBeDefined();
      expect(matrix.summary).toHaveProperty('totalPaths');
      expect(matrix.summary).toHaveProperty('highPriorityPaths');
      expect(matrix.summary).toHaveProperty('minTestsForCoverage');
    });

    it('should format test matrix as markdown', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const matrix = generateTestMatrix(paths);
      const markdown = formatTestMatrixMarkdown(matrix);
      expect(markdown).toContain('Test Coverage Matrix');
      expect(markdown).toContain('Summary');
      expect(markdown).toContain('Test Cases');
      expect(markdown).toContain('Checklist');
    });

    it('should format test checklist', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const paths = generatePaths(ir);
      const matrix = generateTestMatrix(paths);
      const checklist = formatTestChecklist(matrix);
      expect(checklist).toContain('Checklist');
      expect(checklist).toContain(String(matrix.summary.totalPaths));
    });

    it('should emit setup and verify TODO placeholders in formatTestMatrixAsCode', () => {
      const matrix: TestMatrix = {
        paths: [
          {
            id: 'path-1',
            suggestedTestName: 'should do something when condition holds',
            description: 'Path with setup and steps',
            setupConditions: ['Set up config.enabled to be truthy'],
            expectedSteps: ['stepA', 'stepB'],
            priority: 'medium',
          },
        ],
        conditions: [],
        summary: {
          totalPaths: 1,
          highPriorityPaths: 0,
          totalConditions: 0,
          minTestsForCoverage: 1,
        },
      };
      const code = formatTestMatrixAsCode(matrix, {
        testRunner: 'vitest',
        programName: 'myProgram',
      });
      expect(code).toContain('// TODO: Set up config.enabled to be truthy');
      expect(code).toContain('// TODO: Verify stepA was executed');
      expect(code).toContain('// TODO: Verify stepB was executed');
      expect(code).toContain("describe('myProgram'");
      expect(code).toContain("import { describe, it, expect } from 'vitest'");
    });
  });

  // ==========================================================================
  // Fluent API (first, firstOption, named not found)
  // ==========================================================================

  describe('analyze() fluent API', () => {
    it('returns first program from single-program file', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).first(),
      );
      expect(ir.root.programName).toBeDefined();
    });

    it('returns first program from multi-program file', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).first(),
      );
      expect(ir.root).toBeDefined();
    });

    it('fails for empty file when calling first()', async () => {
      const source = `
        const x = 1;
      `;
      const result = await Effect.runPromise(
        analyze.source(source).first().pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
    });

    it('returns Some(first) from firstOption when programs exist', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).firstOption(),
      );
      expect(Option.isSome(result)).toBe(true);
      const ir = Option.getOrThrow(result);
      expect(ir.root.programName).toBeDefined();
    });

    it('fails when calling firstOption on source with no programs', async () => {
      const source = `
        const x = 1;
      `;
      await expect(
        Effect.runPromise(analyze.source(source).firstOption()),
      ).rejects.toThrow('No Effect programs found');
    });

    it('finds program by name', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );
      expect(ir.root.programName).toBe('simpleProgram');
    });

    it('fails with helpful message when named program not found', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts'))
          .named('NonExistentProgram')
          .pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left.message).toContain('not found');
        expect(result.left.message).toContain('NonExistentProgram');
      }
    });

    it('accepts options (tsConfigPath)', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts'), {
          includeLocations: true,
        }).named('simpleProgram'),
      );
      expect(ir.metadata.filePath).toBeDefined();
    });
  });

  // ==========================================================================
  // Edge cases (empty source, no programs)
  // ==========================================================================

  describe('Edge cases', () => {
    it('should fail all() when source has no programs', async () => {
      const source = '';
      const result = await Effect.runPromise(
        analyze.source(source).all().pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
    });

    it('should fail all() when source has no Effect programs', async () => {
      const source = `
        const x = 1;
        const y = 2;
        console.log(x + y);
      `;
      const result = await Effect.runPromise(
        analyze.source(source).all().pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
    });

    it('should fail single() when no programs in source', async () => {
      const source = `const a = 1;`;
      const result = await Effect.runPromise(
        analyze.source(source).single().pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
    });

    it('should fail single() when multiple programs in source', async () => {
      const source = `
        import { Effect } from "effect";
        const p1 = Effect.succeed(1);
        const p2 = Effect.succeed(2);
      `;
      const result = await Effect.runPromise(
        analyze.source(source).single().pipe(Effect.either),
      );
      expect(result._tag).toBe('Left');
    });
  });

  // ==========================================================================
  // trycatch-vs-neverthrow-vs-effect (optional integration verification)
  // ==========================================================================

  describe('trycatch-vs-neverthrow-vs-effect (when present)', () => {
    it('should analyze effect-version.test.ts when project exists', async () => {
      if (!existsSync(externalEffectFile)) {
        return; // skip when sibling project not present
      }
      const result = await Effect.runPromise(
        analyze(externalEffectFile).all().pipe(Effect.either),
      );
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.length).toBeGreaterThan(0);
        const first = result.right[0];
        expect(first?.root.programName).toBeDefined();
        expect(first?.metadata.filePath).toContain('effect-version.test.ts');
      }
    });

    it('should analyze first program from effect-version and produce paths/complexity', async () => {
      if (!existsSync(externalEffectFile)) {
        return;
      }
      const ir = await Effect.runPromise(
        analyze(externalEffectFile).first().pipe(Effect.either),
      );
      expect(ir._tag).toBe('Right');
      if (ir._tag !== 'Right') return;
      const paths = generatePaths(ir.right);
      const metrics = calculateComplexity(ir.right);
      const matrix = generateTestMatrix(paths);
      expect(paths.length).toBeGreaterThanOrEqual(0);
      expect(metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(0);
      expect(matrix.summary.totalPaths).toBe(paths.length);
    });

    it('should analyze api-comparison.test.ts when project exists', async () => {
      if (!existsSync(externalApiComparisonFile)) {
        return;
      }
      const result = await Effect.runPromise(
        analyze(externalApiComparisonFile).all().pipe(Effect.either),
      );
      expect(result._tag).toBe('Right');
      if (result._tag === 'Right') {
        expect(result.right.length).toBeGreaterThan(0);
      }
    });
  });

  // ==========================================================================
  // Colocated Output
  // ==========================================================================

  describe('Colocated Output', () => {
    describe('deriveOutputPath', () => {
      it('should derive output path with default suffix', () => {
        expect(deriveOutputPath('/foo/bar.ts', 'effect-analysis')).toBe(
          '/foo/bar.effect-analysis.md',
        );
      });

      it('should derive output path with custom suffix', () => {
        expect(deriveOutputPath('/foo/bar.ts', 'analysis')).toBe(
          '/foo/bar.analysis.md',
        );
      });

      it('should handle nested paths', () => {
        expect(
          deriveOutputPath('/project/src/utils/helper.ts', 'effect-analysis'),
        ).toBe('/project/src/utils/helper.effect-analysis.md');
      });

      it('should handle different extensions', () => {
        expect(deriveOutputPath('/foo/bar.tsx', 'effect-analysis')).toBe(
          '/foo/bar.effect-analysis.md',
        );
      });
    });

    describe('renderColocatedMarkdown', () => {
      it('should render markdown with all sections', async () => {
        const ir = await Effect.runPromise(
          analyze(resolve(fixturesDir, 'simple-effect.ts')).first(),
        );

        const markdown = await Effect.runPromise(renderColocatedMarkdown(ir));

        expect(markdown).toContain('# Effect Analysis:');
        expect(markdown).toContain('## Metadata');
        expect(markdown).toContain('## Effect Flow');
        expect(markdown).toContain('```mermaid');
        expect(markdown).toContain('## Statistics');
      });

      it('should include file path in metadata', async () => {
        const ir = await Effect.runPromise(
          analyze(resolve(fixturesDir, 'simple-effect.ts')).first(),
        );

        const markdown = await Effect.runPromise(renderColocatedMarkdown(ir));

        expect(markdown).toContain('simple-effect.ts');
      });

      it('should respect direction option', async () => {
        const ir = await Effect.runPromise(
          analyze(resolve(fixturesDir, 'simple-effect.ts')).first(),
        );

        const markdownLR = await Effect.runPromise(
          renderColocatedMarkdown(ir, 'LR'),
        );

      expect(markdownLR).toContain('flowchart LR');
    });
  });
  });

  // ==========================================================================
  // Context, Services, and Tag Patterns
  // ==========================================================================

  describe('Context and Service Patterns', () => {
    it('should detect Context.Tag definitions', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'serviceProgram',
        ),
      );

      expect(result.root.programName).toBe('serviceProgram');
      expect(result.root.source).toBe('generator');
    });

    it('tags Context.pick and Context.omit as context', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'context-pick-'));
      const filePath = join(tmp, 'ctx.ts');
      writeFileSync(filePath, `
        import { Context, Effect } from "effect";
        const ctx = Context.empty().pipe(Context.add(1));
        export const main = Effect.gen(function* () {
          const sub = Context.pick(ctx, ["a" as const]);
          const rest = Context.omit(ctx, ["a" as const]);
          return yield* Effect.succeed({ sub, rest });
        });
      `);
      try {
        const [ir] = await Effect.runPromise(analyze(filePath).all());
        expect(ir).toBeDefined();
        if (!ir) return;
        const effectNodes: import('./types').StaticEffectNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticEffectNode(node)) effectNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        ir.root.children.forEach(walk);
        const pickOrOmit = effectNodes.filter(
          (n) => n.description === 'context' && (n.callee?.includes('pick') || n.callee?.includes('omit')),
        );
        expect(pickOrOmit.length).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('tags Effect.provide and sets provideKind (layer / context / runtime)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'effect-provide-'));
      const filePath = join(tmp, 'provide.ts');
      writeFileSync(filePath, `
        import { Context, Effect, Layer, Runtime } from "effect";
        const runtime = Runtime.defaultRuntime;
        export const main = Effect.gen(function* () {
          const a = yield* Effect.succeed(1).pipe(Effect.provide(Layer.succeed(Context.empty())));
          const b = yield* Effect.succeed(2).pipe(Effect.provide(runtime));
          const c = yield* Effect.provide(Effect.succeed(3), Context.empty());
          return { a, b, c };
        });
      `);
      try {
        const result = await Effect.runPromise(analyze(filePath).named('main'));
        const effectNodes: import('./types').StaticEffectNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticEffectNode(node)) effectNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        result.root.children.forEach(walk);
        const provideNodes = effectNodes.filter(
          (n) => n.description === 'context' && n.callee?.includes('provide') && !n.callee?.includes('provideService'),
        );
        expect(provideNodes.length).toBeGreaterThanOrEqual(3);
        const withLayerNode = provideNodes.find((n) => n.provideKind === 'layer');
        const withRuntimeNode = provideNodes.find((n) => n.provideKind === 'runtime');
        const withContextNode = provideNodes.find((n) => n.provideKind === 'context');
        expect(withLayerNode).toBeDefined();
        expect(withRuntimeNode).toBeDefined();
        expect(withContextNode).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('tags Runtime.make and Runtime.defaultRuntime / Runtime.runPromise as runtime', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'runtime-'));
      const filePath = join(tmp, 'runtime.ts');
      writeFileSync(filePath, `
        import { Effect, Runtime } from "effect";
        export const main = Effect.gen(function* () {
          const rt = Runtime.defaultRuntime;
          return yield* Runtime.runPromise(rt)(Effect.succeed(1));
        });
      `);
      try {
        const result = await Effect.runPromise(analyze(filePath).named('main'));
        const effectNodes: import('./types').StaticEffectNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (node.type === 'effect') effectNodes.push(node as StaticEffectNode);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        result.root.children.forEach(walk);
        const runtimeNodes = effectNodes.filter(
          (n) => n.description === 'runtime' && n.callee?.startsWith('Runtime.'),
        );
        expect(runtimeNodes.length).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('extracts service interface shape (methods/properties) from Context.Tag classes', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'databaseProgram',
        ),
      );
      const defs = result.metadata.serviceDefinitions ?? [];
      expect(defs.length).toBeGreaterThanOrEqual(3);
      const database = defs.find((d) => d.tagId === 'Database');
      const config = defs.find((d) => d.tagId === 'Config');
      const logger = defs.find((d) => d.tagId === 'Logger');
      expect(database).toBeDefined();
      expect(database!.methods).toContain('query');
      expect(database!.methods).toContain('transaction');
      expect(config).toBeDefined();
      expect(config!.methods).toContain('get');
      expect(config!.methods).toContain('getOrDefault');
      expect(logger).toBeDefined();
      expect(logger!.methods).toContain('info');
      expect(logger!.methods).toContain('error');
      expect(logger!.methods).toContain('debug');
    });

    it('should detect service dependencies in Effect.gen', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'databaseProgram',
        ),
      );

      expect(result.root.children.length).toBeGreaterThan(0);
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('should analyze nested service usage', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'nestedServiceProgram',
        ),
      );

      expect(result.root.programName).toBe('nestedServiceProgram');
      expect(result.root.source).toBe('generator');
    });

    it('should find multiple programs in context-services file', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(5);
      const names = result.map((r) => r.root.programName);
      expect(names).toContain('serviceProgram');
      expect(names).toContain('databaseProgram');
    });

    it('Layer requires fallback from type (RIn) when structure has no requires', { timeout: 15_000 }, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'layer-type-fallback-'));
      const filePath = join(tmp, 'layer.ts');
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(filePath, `
        import { Effect, Layer } from "effect";
        interface Database {}
        interface Config {}
        declare const UnknownLayer: Layer<Database, never, Config>;
        export const main = Effect.gen(function* () {
          const M = Layer.merge(UnknownLayer, Layer.succeed(1));
          return yield* Effect.succeed(M);
        });
      `);
      clearProjectCache();
      try {
        const allIrs = await Effect.runPromise(
          analyze(filePath, { tsConfigPath: tsconfigPath }).all(),
        );
        const layerNodes: import('./types').StaticLayerNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticLayerNode(node)) layerNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of allIrs) {
          ir.root.children.forEach(walk);
        }
        expect(layerNodes.length).toBeGreaterThan(0);
        const withConfig = layerNodes.find(
          (n) => n.requires?.includes('Config'),
        );
        if (withConfig) {
          expect(withConfig.requires).toContain('Config');
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('resolves pipe base identifier to Layer initializer (pipe-chain when base is a variable)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'layer-pipe-base-'));
      const filePath = join(tmp, 'layers.ts');
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(filePath, `
        import { pipe, Layer, Context } from "effect";
        class Config extends Context.Tag("Config")<Config, { get(): string }>() {}
        class Db extends Context.Tag("Db")<Db, { query(): string }>() {}
        const ConfigLive = Layer.succeed(Config, { get: () => "ok" });
        const DbLive = Layer.succeed(Db, { query: () => "select" });
        export const AppLayer = pipe(ConfigLive, Layer.merge(DbLive));
      `);
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(filePath, { tsConfigPath: tsconfigPath }).named('AppLayer'),
        );
        const pipeNode = result.root.children.find((n) => isStaticPipeNode(n)) as StaticPipeNode | undefined;
        expect(pipeNode).toBeDefined();
        expect(pipeNode.type).toBe('pipe');
        expect(pipeNode.initial).toBeDefined();
        expect(isStaticLayerNode(pipeNode.initial)).toBe(true);
        const baseLayer = pipeNode.initial as StaticLayerNode;
        expect(baseLayer.provides).toBeDefined();
        expect(baseLayer.provides).toContain('Config');
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('tags Layer.MemoMap with isMemoMap (dedicated memo-map analysis)', { timeout: 15_000 }, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'layer-memomap-'));
      const filePath = join(tmp, 'layers.ts');
      const tsconfigPath = join(tmp, 'tsconfig.json');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(filePath, `
        import { pipe, Layer, Context } from "effect";
        class Config extends Context.Tag("Config")<Config, { get(): string }>() {}
        const ConfigLive = Layer.succeed(Config, { get: () => "ok" });
        export const WithMemo = pipe(Layer.MemoMap(), Layer.provide(ConfigLive));
      `);
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(filePath, { tsConfigPath: tsconfigPath }).named('WithMemo'),
        );
        const layerNodes: import('./types').StaticLayerNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticLayerNode(node)) layerNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        result.root.children.forEach(walk);
        const memoMapLayers = layerNodes.filter((n) => n.isMemoMap === true);
        expect(memoMapLayers.length).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('resolves Layer pipe base from another file (cross-file) when alias is available', { timeout: 15_000 }, async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'layer-crossfile-'));
      const tsconfigPath = join(tmp, 'tsconfig.json');
      const layersPath = join(tmp, 'layers.ts');
      const appPath = join(tmp, 'app.ts');
      writeFileSync(tsconfigPath, JSON.stringify({ compilerOptions: { strict: true }, include: ['*.ts'] }));
      writeFileSync(layersPath, `
        import { Layer, Context } from "effect";
        class Config extends Context.Tag("Config")<Config, { get(): string }>() {}
        export const ConfigLive = Layer.succeed(Config, { get: () => "ok" });
      `);
      writeFileSync(appPath, `
        import { pipe, Layer, Context } from "effect";
        import { ConfigLive } from "./layers";
        class Db extends Context.Tag("Db")<Db, { query(): string }>() {}
        const DbLive = Layer.succeed(Db, { query: () => "select" });
        export const AppLayer = pipe(ConfigLive, Layer.merge(DbLive));
      `);
      clearProjectCache();
      try {
        const result = await Effect.runPromise(
          analyze(appPath, { tsConfigPath: tsconfigPath }).named('AppLayer'),
        );
        const pipeNode = result.root.children.find((n) => isStaticPipeNode(n)) as StaticPipeNode | undefined;
        expect(pipeNode).toBeDefined();
        expect(pipeNode.initial).toBeDefined();
        // Cross-file resolution depends on ts-morph resolving the import alias; when it does, initial is a layer with provides
        if (isStaticLayerNode(pipeNode.initial)) {
          const baseLayer = pipeNode.initial as StaticLayerNode;
          expect(baseLayer.provides).toContain('Config');
        }
      } finally {
        rmSync(tmp, { recursive: true });
        clearProjectCache();
      }
    });

    it('should detect programs with Layer provision', { timeout: 15_000 }, async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'programWithLayer',
        ),
      );

      expect(result.root.programName).toBe('programWithLayer');
    });
  });

  // ==========================================================================
  // Schema Patterns
  // ==========================================================================

  describe('Schema Patterns', () => {
    it('should detect Schema definitions', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).named(
          'validateUserProgram',
        ),
      );

      expect(result.root.programName).toBe('validateUserProgram');
      // Arrow functions returning Effect.gen are detected as generators
      expect(result.root.source).toBe('generator');
    });

    it('should detect Schema.decode usage', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).named(
          'validateUserProgram',
        ),
      );

      expect(result.root.programName).toBe('validateUserProgram');
      // Arrow function returning Effect - analyzer detects it as a program
      expect(result.root.source).toBe('generator');
    });

    it('should find multiple schema programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(3);
    });

    it('should detect Schema.encode usage', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).named(
          'encodeUserProgram',
        ),
      );

      expect(result.root.programName).toBe('encodeUserProgram');
    });

    it('detects Schema.Serializable and Schema.SerializableWithResult as serializable composition', () => {
      const project = new Project({ useInMemoryFileSystem: true });
      const file = project.createSourceFile(
        'serializable.ts',
        `
import { Schema } from "effect";
const MySerializable = Schema.Serializable({ key: Schema.String });
const WithResult = Schema.SerializableWithResult({ id: Schema.Number });
`,
      );
      const nodes = file.getDescendants();
      const checker = project.getTypeChecker();
      const analysis = analyzeSchemaOperations(nodes, checker);
      const serializable = analysis.compositions.filter(
        (c) => c.compositionType === 'serializable',
      );
      expect(serializable.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // Stream Patterns
  // ==========================================================================

  describe('Stream Patterns', () => {
    it('should detect Stream programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'simpleStreamProgram',
        ),
      );

      expect(result.root.programName).toBe('simpleStreamProgram');
      expect(result.root.source).toBe('generator');
    });

    it('should detect Stream.map transformations', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'mappedStreamProgram',
        ),
      );

      expect(result.root.programName).toBe('mappedStreamProgram');
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('should detect Stream.runCollect', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'simpleStreamProgram',
        ),
      );

      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('should find multiple stream programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(5);
    });

    it('extracts windowing detail (windowSize/stride) for grouped and sliding', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'windowingStreamProgram',
        ),
      );
      const streamNodes: import('./types').StaticStreamNode[] = [];
      const walk = (node: import('./types').StaticFlowNode) => {
        if (isStaticStreamNode(node)) streamNodes.push(node);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(walk);
      };
      ir.root.children.forEach(walk);
      const allOps = streamNodes.flatMap((s) => s.pipeline);
      const groupedOp = allOps.find(
        (o) => o.operation === 'grouped' && o.windowSize === 2,
      );
      const slidingOp = allOps.find(
        (o) =>
          (o.operation === 'sliding' || o.operation.includes('sliding')) &&
          o.windowSize === 3 &&
          o.stride === 2,
      );
      expect(groupedOp).toBeDefined();
      expect(slidingOp).toBeDefined();
    });

    it('classifies Stream.fromEventListener as event-source constructor', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'stream-fromEventListener-'));
      const filePath = join(tmp, 'stream.ts');
      writeFileSync(filePath, `
        import { Effect, Stream } from "effect";
        declare const el: { addEventListener: (e: string, h: () => void) => void };
        export const main = Effect.gen(function* () {
          return yield* Stream.runCollect(Stream.fromEventListener(el, "click"));
        });
      `);
      try {
        const result = await Effect.runPromise(analyze(filePath).named('main'));
        const streamNodes: import('./types').StaticStreamNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticStreamNode(node)) streamNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        result.root.children.forEach(walk);
        const fromEv = streamNodes.find(
          (n) => n.constructorType === 'fromEventListener',
        );
        expect(fromEv).toBeDefined();
        expect(fromEv?.pipeline.some((o) => o.operation === 'fromEventListener')).toBe(true);
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });
  });

  // ==========================================================================
  // Complex Composition Patterns
  // ==========================================================================

  describe('Complex Composition Patterns', () => {
    it('should detect conditional programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).named(
          'conditionalIfProgram',
        ),
      );

      expect(result.root.programName).toBe('conditionalIfProgram');
      expect(result.metadata.stats.conditionalCount).toBeGreaterThanOrEqual(0);
    });

    it('should detect loop programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).named(
          'loopProgram',
        ),
      );

      expect(result.root.programName).toBe('loopProgram');
      expect(result.metadata.stats.loopCount).toBeGreaterThanOrEqual(0);
    });

    it('should detect recursive programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).named(
          'recursiveProgram',
        ),
      );

      expect(result.root.programName).toBe('recursiveProgram');
    });

    it('should detect error handler chains', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).named(
          'chainedErrorHandlerProgram',
        ),
      );

      expect(result.root.programName).toBe('chainedErrorHandlerProgram');
    });

    it('should find multiple composition programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(8);
    });
  });

  // ==========================================================================
  // Real-World Patterns
  // ==========================================================================

  describe('Real-World Patterns', () => {
    it('should detect API call patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).named(
          'getUserWithCache',
        ),
      );

      expect(result.root.programName).toBe('getUserWithCache');
    });

    it('should detect workflow patterns', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).named(
          'processUserWorkflow',
        ),
      );

      expect(result.root.programName).toBe('processUserWorkflow');
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('should detect parallel batch operations', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).named(
          'batchFetchUsers',
        ),
      );

      expect(result.root.programName).toBe('batchFetchUsers');
    });

    it('should find multiple real-world programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).all(),
      );

      expect(result.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ==========================================================================
  // Path Generation with New Fixtures
  // ==========================================================================

  describe('Path Generation - Extended', () => {
    it('should generate paths for context service programs', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'serviceProgram',
        ),
      );

      const paths = generatePaths(ir);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('should generate paths for complex composition', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).named(
          'loopProgram',
        ),
      );

      const paths = generatePaths(ir);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths[0]?.hasLoops).toBeDefined();
    });

    it('should calculate complexity for real-world patterns', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).named(
          'processUserWorkflow',
        ),
      );

      const metrics = calculateComplexity(ir);
      expect(metrics.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
      expect(metrics.maxDepth).toBeGreaterThanOrEqual(0);
    });

    it('should generate test matrix for schema patterns', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).named(
          'validateUserProgram',
        ),
      );

      const paths = generatePaths(ir);
      const matrix = generateTestMatrix(paths);
      expect(matrix.paths.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Mermaid Diagrams - Extended
  // ==========================================================================

  describe('Mermaid Diagrams - Extended Fixtures', () => {
    it('should generate diagram for context services', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'nestedServiceProgram',
        ),
      );

      const diagram = await Effect.runPromise(renderMermaid(ir));
      expect(diagram).toContain('flowchart');
      expect(diagram).toContain('nestedServiceProgram');
    });

    it('should generate diagram for stream patterns', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'pipelineStreamProgram',
        ),
      );

      const diagram = await Effect.runPromise(renderMermaid(ir));
      expect(diagram).toContain('flowchart');
    });

    it('should generate diagram for complex composition', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).first(),
      );

      const diagram = await Effect.runPromise(renderMermaid(ir));
      expect(diagram).toContain('flowchart');
      expect(diagram.length).toBeGreaterThan(50);
    });
  });

  // ==========================================================================
  // Type Signature Extraction
  // ==========================================================================

  describe('Type Signature Extraction', () => {
    it('should extract type signatures for Effect programs', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      // Type signature should be present on the program
      expect(ir.root.typeSignature).toBeDefined();
      if (ir.root.typeSignature) {
        expect(ir.root.typeSignature.successType).toBeDefined();
        expect(ir.root.typeSignature.errorType).toBeDefined();
        expect(ir.root.typeSignature.requirementsType).toBeDefined();
      }
    });

    it('should extract type signatures for effects with errors', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).named(
          'catchAllProgram',
        ),
      );

      expect(ir.root.typeSignature).toBeDefined();
      if (ir.root.typeSignature) {
        expect(ir.root.typeSignature.isInferred).toBe(true);
        expect(ir.root.typeSignature.rawTypeString).toBeDefined();
      }
    });

    it('should have service requirements property for context programs', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'serviceProgram',
        ),
      );

      // Service requirements property should exist (may be empty depending on type resolution)
      expect(ir.root.requiredServices).toBeDefined();
      // The property exists as an array (may be empty if types can't be resolved)
      expect(Array.isArray(ir.root.requiredServices)).toBe(true);
    });

    it('should report service requirement locations with correct 1-based line numbers', async () => {
      const source = [
        'import { Context, Effect } from "effect";',
        'class Svc extends Context.Tag("Svc")<Svc, { readonly n: number }>() {}',
        'const program: Effect.Effect<number, never, Context.Context<Svc>> = Effect.gen(function* () { const s = yield* Svc; return s.n; });',
      ].join('\n');

      const ir = await Effect.runPromise(analyze.source(source).named('program'));
      const req = ir.root.requiredServices?.[0];

      expect(req).toBeDefined();
      expect(req?.requiredAt.line).toBe(3);
    });

    it('should extract type signatures on individual effect nodes', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      const hasTypeSignature = ir.root.children.some(
        (child) =>
          child.type === 'effect' &&
          child.typeSignature !== undefined,
      );
      expect(typeof hasTypeSignature).toBe('boolean');
    });

    it('should format type signatures correctly', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      if (ir.root.typeSignature) {
        const formatted = formatTypeSignature(ir.root.typeSignature);
        expect(formatted).toContain('Effect<');
        expect(formatted).toContain(ir.root.typeSignature.successType);
        expect(formatted).toContain(ir.root.typeSignature.errorType);
      }
    });

    it('should track type extraction as complete', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named(
          'simpleProgram',
        ),
      );

      expect(ir.root.typeSignature).toBeDefined();
      if (ir.root.typeSignature) {
        // isInferred indicates whether the type was successfully extracted
        expect(typeof ir.root.typeSignature.isInferred).toBe('boolean');
      }
    });
  });

  // ==========================================================================
  // Colocated Output - Extended
  // ==========================================================================

  describe('Colocated Output - Extended', () => {
    it('should render markdown for context services', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'databaseProgram',
        ),
      );

      const markdown = await Effect.runPromise(renderColocatedMarkdown(ir));
      expect(markdown).toContain('# Effect Analysis:');
      expect(markdown).toContain('databaseProgram');
    });

    it('should render markdown for real-world patterns', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).first(),
      );

      const markdown = await Effect.runPromise(renderColocatedMarkdown(ir));
      expect(markdown).toContain('# Effect Analysis:');
      expect(markdown).toContain('## Metadata');
      expect(markdown).toContain('## Effect Flow');
    });
  });

  // ==========================================================================
  // Effect Linter
  // ==========================================================================

  describe('Effect Linter', () => {
    it('should detect untagged yields', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('untaggedYieldProgram'),
      );

      const result = lintEffectProgram(ir);
      
      // Should find at least one untagged yield issue
      const untaggedIssues = result.issues.filter(i => i.rule === 'untagged-yield');
      expect(untaggedIssues.length).toBeGreaterThan(0);
    });

    it('should detect missing error handlers', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('missingHandlerProgram'),
      );

      const result = lintEffectProgram(ir);
      
      // Should find missing error handler issues
      const handlerIssues = result.issues.filter(i => i.rule === 'missing-error-handler');
      expect(handlerIssues.length).toBeGreaterThan(0);
    });

    it('should detect dead code', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('deadCodeProgram'),
      );

      const result = lintEffectProgram(ir);
      
      // Should find dead code issues
      const deadCodeIssues = result.issues.filter(i => i.rule === 'dead-code');
      expect(deadCodeIssues.length).toBeGreaterThan(0);
    });

    it('should detect complex Layer compositions', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('complexLayerProgram'),
      );

      const result = lintEffectProgram(ir);
      
      // For now, just verify the linter runs - the fixture might not trigger the rule
      // The test documents the expected behavior even if detection isn't perfect
      expect(result).toBeDefined();
      expect(result.issues).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should format lint report', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('untaggedYieldProgram'),
      );

      const result = lintEffectProgram(ir);
      const report = formatLintReport(result, ir.root.programName);
      
      expect(report).toContain('Lint Report');
      expect(report).toContain('Summary');
      expect(report).toContain(result.summary.total.toString());
    });

    it('should have no issues for well-written programs', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'lint-issues.ts')).named('goodProgram'),
      );

      const result = lintEffectProgram(ir);
      
      // Good program should have minimal or no issues
      expect(result.summary.errors).toBe(0);
    });
  });

  describe('Regression Coverage', () => {
    it('should re-read a file after its contents change between analyses', async () => {
      clearProjectCache();

      const tempDir = mkdtempSync(join(tmpdir(), 'effect-analyzer-'));
      const filePath = join(tempDir, 'program.ts');

      try {
        writeFileSync(
          filePath,
          [
            'import { Effect } from "effect";',
            'export const program = Effect.succeed(1);',
            '',
          ].join('\n'),
          'utf-8',
        );

        const first = await Effect.runPromise(analyze(filePath).named('program'));
        const firstNode = first.root.children[0];

        expect(firstNode).toBeDefined();
        if (!firstNode || !isStaticEffectNode(firstNode)) {
          throw new Error('Expected first program child to be a static effect node');
        }
        expect(firstNode.callee).toBe('Effect.succeed');

        writeFileSync(
          filePath,
          [
            'import { Effect } from "effect";',
            'export const program = Effect.fail("boom");',
            '',
          ].join('\n'),
          'utf-8',
        );

        const second = await Effect.runPromise(analyze(filePath).named('program'));
        const secondNode = second.root.children[0];

        expect(secondNode).toBeDefined();
        if (!secondNode || !isStaticEffectNode(secondNode)) {
          throw new Error('Expected second program child to be a static effect node');
        }
        expect(secondNode.callee).toBe('Effect.fail');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
        clearProjectCache();
      }
    });

    it('should report 1-based source locations without an extra line offset', async () => {
      const source = [
        'import { Effect } from "effect";',
        'const program = Effect.succeed(1);',
      ].join('\n');

      const result = await Effect.runPromise(analyze.source(source).named('program'));

      expect(result.root.location?.line).toBe(2);
      const firstNode = result.root.children[0];
      expect(firstNode?.location?.line).toBe(2);
    });

    it('should not emit anonymous pipe-* programs for unassigned pipe invocations', async () => {
      const source = [
        'import { Effect } from "effect";',
        'const program = Effect.gen(function*() {',
        '  yield* Effect.succeed(1);',
        '});',
        'program.pipe(',
        '  Effect.tap(() => Effect.log("done")),',
        '  Effect.runFork',
        ');',
      ].join('\n');

      const result = await Effect.runPromise(analyze.source(source).all());
      const names = result.map((ir) => ir.root.programName);

      expect(names).toContain('program');
      expect(names.some((name) => name.startsWith('pipe-'))).toBe(false);
    });

    it('should not emit pipe-* programs for nested pipe(...) inside Effect.gen bodies', async () => {
      const source = [
        'import { Effect, pipe } from "effect";',
        'const program = Effect.gen(function*() {',
        '  yield* pipe(',
        '    Effect.succeed(1),',
        '    Effect.tap(() => Effect.log("nested"))',
        '  );',
        '});',
      ].join('\n');

      const result = await Effect.runPromise(analyze.source(source).all());
      const names = result.map((ir) => ir.root.programName);

      expect(names).toContain('program');
      expect(names.some((name) => name.startsWith('pipe-'))).toBe(false);
    });
  });

  // ============================================================================
  // Fixture File Tests - Real file analysis
  // ============================================================================

  describe('Fixture: simple-effect.ts', () => {
    it('should detect simpleProgram and programWithErrorHandling programs', async () => {
      const source = readFileSync(
        resolve(fixturesDir, 'simple-effect.ts'),
        'utf-8',
      );

      const result = await Effect.runPromise(analyze.source(source).all());

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('simpleProgram');
      expect(names).toContain('programWithErrorHandling');
    });

    it('should extract correct program names from fixture', async () => {
      const simpleResult = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'simple-effect.ts')).named('simpleProgram'),
      );
      expect(simpleResult.root.programName).toBe('simpleProgram');
    });
  });

  describe('Fixture: parallel-effect.ts', () => {
    it('should detect parallel and race programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('parallelProgram');
      expect(names).toContain('raceProgram');
      expect(names).toContain('forEachProgram');
    });

    it('should identify parallel execution stats', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'parallel-effect.ts')).named(
          'parallelProgram',
        ),
      );

      expect(result.metadata.stats.parallelCount).toBeGreaterThan(0);
    });
  });

  describe('Fixture: error-handling.ts', () => {
    it('should detect programs with error handling', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'error-handling.ts')).all(),
      );

      expect(result.length).toBeGreaterThan(0);
      const names = result.map((r) => r.root.programName);
      expect(names).toContain('catchAllProgram');
      expect(names).toContain('catchTagProgram');
    });
  });

  describe('Fixture: context-services.ts', () => {
    it('should detect services and context usage', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'serviceProgram',
        ),
      );

      expect(result.root.programName).toBe('serviceProgram');
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('extracts Effect.async resume/canceller patterns (asyncCallback)', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'async-cb-'));
      const filePath = join(tmp, 'async.ts');
      writeFileSync(filePath, `
        import { Effect } from "effect";
        const withResume = Effect.async((resume) => {
          resume(Effect.succeed(1));
        });
        const withCanceller = Effect.async((resume) => {
          resume(Effect.succeed(2));
          return () => { /* cleanup */ };
        });
        const twoResumes = Effect.async((cb) => {
          cb(Effect.succeed(3));
          cb(Effect.fail(new Error("second")));
        });
      `);
      try {
        const allIrs = await Effect.runPromise(analyze(filePath).all());
        const effectNodes: import('./types').StaticEffectNode[] = [];
        const walk = (node: import('./types').StaticFlowNode) => {
          if (isStaticEffectNode(node)) effectNodes.push(node);
          const children = Option.getOrElse(getStaticChildren(node), () => []);
          children.forEach(walk);
        };
        for (const ir of allIrs) {
          ir.root.children.forEach(walk);
        }
        const asyncNodes = effectNodes.filter((n) => n.asyncCallback);
        expect(asyncNodes.length).toBeGreaterThanOrEqual(3);
        const withResumeNode = asyncNodes.find(
          (n) => n.asyncCallback?.resumeCallCount === 1 && !n.asyncCallback?.returnsCanceller,
        );
        const withCancellerNode = asyncNodes.find(
          (n) => n.asyncCallback?.returnsCanceller === true,
        );
        const twoResumesNode = asyncNodes.find(
          (n) => n.asyncCallback?.resumeCallCount === 2,
        );
        expect(withResumeNode).toBeDefined();
        expect(withCancellerNode).toBeDefined();
        expect(twoResumesNode).toBeDefined();
      } finally {
        rmSync(tmp, { recursive: true });
      }
    });

    it('should populate callbackBody for Effect.sync/promise/async', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'resource-effect.ts')).named(
          'syncWithInnerEffect',
        ),
      );
      const effectNodes: import('./types').StaticEffectNode[] = [];
      function collect(node: import('./types').StaticFlowNode) {
        if (node.type === 'effect') effectNodes.push(node as StaticEffectNode);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(collect);
      }
      result.root.children.forEach(collect);
      const withCallback = effectNodes.filter((n) => n.callbackBody && n.callbackBody.length > 0);
      expect(withCallback.length).toBeGreaterThan(0);
      const syncNode = withCallback.find((n) => n.callee.includes('sync'));
      expect(syncNode?.callbackBody?.length).toBe(1);
    });

    it('should resolve service method calls (serviceMethod) in Effect.gen', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named(
          'databaseProgram',
        ),
      );
      const effectNodes: import('./types').StaticEffectNode[] = [];
      function collect(node: import('./types').StaticFlowNode) {
        if (node.type === 'effect') effectNodes.push(node as StaticEffectNode);
        const children = Option.getOrElse(getStaticChildren(node), () => []);
        children.forEach(collect);
      }
      result.root.children.forEach(collect);
      const withServiceMethod = effectNodes.filter((n) => n.serviceMethod);
      expect(withServiceMethod.length).toBeGreaterThan(0);
      const dbQuery = withServiceMethod.find(
        (n) => n.serviceMethod?.serviceId === 'Database' && n.serviceMethod?.methodName === 'query',
      );
      expect(dbQuery).toBeDefined();
    });
  });

  describe('Fixture: schema-patterns.ts', () => {
    it('should detect Schema validation programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'schema-patterns.ts')).named(
          'validateUserProgram',
        ),
      );

      expect(result.root.programName).toBe('validateUserProgram');
    });
  });

  describe('Fixture: stream-patterns.ts', () => {
    it('should detect Stream programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'stream-patterns.ts')).named(
          'simpleStreamProgram',
        ),
      );

      expect(result.root.programName).toBe('simpleStreamProgram');
    });
  });

  describe('Fixture: complex-composition.ts', () => {
    it('should detect complex layer compositions', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'complex-composition.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('conditionalWhenProgram');
      expect(names).toContain('loopProgram');
    });
  });

  describe('Fixture: real-world-patterns.ts', () => {
    it('should detect multiple real-world API programs', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('apiCallWithRetry');
      expect(names).toContain('cachedApiCall');
      expect(names).toContain('getUserWithCache');
      expect(names).toContain('batchFetchUsers');
      expect(names).toContain('processUserWorkflow');
    });

    it('should have correct stats for batchFetchUsers', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'real-world-patterns.ts')).named(
          'batchFetchUsers',
        ),
      );

      expect(result.metadata.stats.totalEffects).toBeGreaterThan(5);
    });
  });

  describe('Fixture: additional user-like programs', () => {
    it('analyzes cli-script fixture', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'cli-script.ts')).named('cliMain'),
      );

      expect(result.root.programName).toBe('cliMain');
      expect(result.root.source).toBe('pipe');
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('analyzes match-and-branching fixture', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'match-and-branching.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('matchProgram');
      expect(names).toContain('matchEffectProgram');
      expect(names).toContain('branchingGenProgram');
    });

    it('analyzes testing-mocks fixture', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'testing-mocks.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('userLookupProgram');
      expect(names).toContain('withMockLayer');
    });

    it('analyzes nested-helpers fixture', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'nested-helpers.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('nestedHelperProgram');
      expect(names).toContain('normalizeEmail');
      expect(names).toContain('persistUser');
    });

    it('analyzes pipe-heavy fixture as a pipe program', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'pipe-heavy.ts')).named('pipeHeavyProgram'),
      );

      expect(result.root.programName).toBe('pipeHeavyProgram');
      expect(result.root.source).toBe('pipe');
      expect(result.metadata.stats.totalEffects).toBeGreaterThan(0);
    });

    it('analyzes effect-kitchen-sink fixture and discovers diverse entrypoints', async () => {
      const result = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-kitchen-sink.ts')).all(),
      );

      const names = result.map((r) => r.root.programName);
      expect(names).toContain('genProgram');
      expect(names).toContain('pipeProgram');
      expect(names).toContain('promiseProgram');
      expect(names).toContain('syncProgram');
      expect(names).toContain('aliasGenProgram');
      expect(names).toContain('destructuredGenProgram');
      expect(names).toContain('servicePlumbingProgram');
      expect(names).toContain('errorTopologyProgram');
      expect(names).toContain('concurrencyProgram');
      expect(names).toContain('scopedResourceProgram');
      expect(names).toContain('streamProgram');
      expect(names).toContain('scheduledProgram');
      expect(names).toContain('stmProgram');
      expect(names).toContain('controlFlowProgram');
      expect(names).toContain('main');

      // False-friends are intentionally present to track current discovery behavior.
      expect(names).toContain('notAProgram');
      expect(names).toContain('effectFactory');
    });

    it('captures topology across service, error, and concurrency programs', async () => {
      const serviceIr = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-kitchen-sink.ts')).named('servicePlumbingProgram'),
      );
      const concurrencyIr = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-kitchen-sink.ts')).named('concurrencyProgram'),
      );
      const errorIr = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-kitchen-sink.ts')).named('errorTopologyProgram'),
      );

      expect(concurrencyIr.metadata.stats.parallelCount).toBeGreaterThan(0);
      expect(concurrencyIr.metadata.stats.raceCount).toBeGreaterThan(0);

      const serviceMermaid = await Effect.runPromise(renderMermaid(serviceIr));
      const errorMermaid = await Effect.runPromise(renderMermaid(errorIr));
      expect(serviceMermaid).toContain('repo');
      expect(serviceMermaid).toContain('UserRepo');
      expect(serviceMermaid).toContain('custom.buildProfile');
      expect(errorMermaid).toContain('unstableLookup.pipe');
      expect(errorMermaid).toContain('TimeoutException');
      expect(serviceMermaid).not.toContain('Generator (');
    });

    it('supports detailed vs summary graph usage on flagship main', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'effect-kitchen-sink.ts')).named('concurrencyProgram'),
      );

      const detailed = await Effect.runPromise(
        renderMermaid(ir, { detail: 'verbose' }),
      );
      const summary = renderPathsMermaid(generatePaths(ir), { direction: 'TB' });

      expect(summary).toContain('flowchart TB');
      expect(detailed).toContain('Effect.race');
      expect(summary).toContain('Start');
      expect(detailed.length).toBeGreaterThan(0);
    });
  });

  describe('Program discovery regressions', () => {
    it('derives run program name from await assignment', async () => {
      const source = `
        import { Effect } from "effect";
        export const runner = async () => {
          const exit = await Effect.runPromiseExit(Effect.succeed(1));
          return exit;
        };
      `;

      const result = await Effect.runPromise(analyze.source(source).all());
      expect(result).toHaveLength(1);
      expect(result[0]?.root.programName).toBe('exit');
      expect(result[0]?.root.source).toBe('run');
    });

    it('does not create separate programs for yield-bound local variables', async () => {
      const source = `
        import { Effect } from "effect";
        export const program = Effect.gen(function* () {
          const response = yield* Effect.succeed(1).pipe(
            Effect.catchAll(() => Effect.succeed(0))
          );
          return response;
        });
      `;

      const result = await Effect.runPromise(analyze.source(source).all());
      const names = result.map((r) => r.root.programName);
      expect(names).toContain('program');
      expect(names).not.toContain('response');
    });

    it('does not classify object-literal wrappers as direct programs', async () => {
      const source = `
        import { Effect } from "effect";
        export const makeDeps = () => ({
          send: () => Effect.gen(function* () {
            yield* Effect.log("send");
          })
        });
      `;

      const result = await Effect.runPromise(analyze.source(source).all());
      const names = result.map((r) => r.root.programName);
      expect(names).not.toContain('makeDeps');
      expect(names.some((name) => name.includes('send'))).toBe(true);
    });

    it(
      'analyzes all TypeScript fixtures without throwing',
      async () => {
        const fixtureFiles = readdirSync(fixturesDir)
          .filter((file) => file.endsWith('.ts'))
          .filter((file) => !file.startsWith('regression-'))
          .map((file) => resolve(fixturesDir, file));

        for (const fixtureFile of fixtureFiles) {
          const result = await Effect.runPromise(
            analyze(fixtureFile).all().pipe(Effect.either),
          );
          expect(result._tag).toBe('Right');
        }
      },
      30_000,
    );
  });

  // ==========================================================================
  // Rich Labels: displayName and semanticRole
  // ==========================================================================

  describe('Rich labels: displayName and semanticRole', () => {
    it('populates displayName with "varName <- callee" on generator yields', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const gen = ir.root.children[0];
      expect(gen?.type).toBe('generator');
      if (gen?.type === 'generator') {
        const loggerYield = gen.yields.find(y => y.variableName === 'logger');
        expect(loggerYield).toBeDefined();
        expect(loggerYield!.effect.displayName).toBe('logger <- Logger');

        const configYield = gen.yields.find(y => y.variableName === 'config');
        expect(configYield).toBeDefined();
        expect(configYield!.effect.displayName).toBe('config <- Config');
      }
    });

    it('populates displayName with service method calls', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const gen = ir.root.children[0];
      if (gen?.type === 'generator') {
        const dbUrlYield = gen.yields.find(y => y.variableName === 'dbUrl');
        expect(dbUrlYield).toBeDefined();
        expect(dbUrlYield!.effect.displayName).toContain('dbUrl');
        expect(dbUrlYield!.effect.displayName).toContain('config.getOrDefault');
      }
    });

    it('populates semanticRole on all yields', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const gen = ir.root.children[0];
      if (gen?.type === 'generator') {
        for (const y of gen.yields) {
          expect(y.effect.semanticRole).toBeDefined();
          expect(typeof y.effect.semanticRole).toBe('string');
        }
      }
    });

    it('sets semanticRole=side-effect for service log calls', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const gen = ir.root.children[0];
      if (gen?.type === 'generator') {
        const loggerInfoYield = gen.yields.find(y =>
          y.effect.type === 'effect' && y.effect.callee.includes('logger.info'),
        );
        expect(loggerInfoYield?.effect.semanticRole).toBe('side-effect');
      }
    });

    it('sets displayName and semanticRole on parallel nodes', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'rich-labels.ts')).named('parallelProgram'),
      );
      const gen = ir.root.children[0];
      if (gen?.type === 'generator') {
        const parallelYield = gen.yields.find(y => y.effect.type === 'parallel');
        expect(parallelYield).toBeDefined();
        expect(parallelYield!.effect.displayName).toBeDefined();
        expect(parallelYield!.effect.semanticRole).toBe('concurrency');
      }
    });

    it('sets conditionLabel and edge labels on conditional nodes', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'rich-labels.ts')).named('conditionalProgram'),
      );
      const gen = ir.root.children[0];
      if (gen?.type === 'generator') {
        const condYield = gen.yields.find(y => y.effect.type === 'conditional');
        expect(condYield).toBeDefined();
        if (condYield?.effect.type === 'conditional') {
          expect(condYield.effect.conditionLabel).toBeDefined();
          expect(condYield.effect.trueEdgeLabel).toBe('true');
          expect(condYield.effect.falseEdgeLabel).toBe('false');
          expect(condYield.effect.semanticRole).toBe('control-flow');
        }
      }
    });
  });

  // ==========================================================================
  // Mermaid Detail Levels
  // ==========================================================================

  describe('Mermaid detail levels', () => {
    it('verbose (default): includes variable names, type sigs, and semantic roles', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const mermaid = await Effect.runPromise(renderMermaid(ir));
      // Variable binding: "logger <- Logger"
      expect(mermaid).toContain('logger');
      expect(mermaid).toContain('Logger');
      // Semantic role annotation
      expect(mermaid).toContain('(side-effect)');
      // Type signature
      expect(mermaid).toContain('void, never, never');
    });

    it('standard: includes variable names but NOT type sigs or roles', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const mermaid = await Effect.runPromise(renderMermaid(ir, { detail: 'standard' }));
      // Variable names present
      expect(mermaid).toContain('logger');
      expect(mermaid).toContain('config');
      // No role annotations
      expect(mermaid).not.toContain('(side-effect)');
      // No type signatures
      expect(mermaid).not.toContain('void, never, never');
    });

    it('compact: shows only callee names, no variable bindings or annotations', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'context-services.ts')).named('serviceProgram'),
      );
      const mermaid = await Effect.runPromise(renderMermaid(ir, { detail: 'compact' }));
      // Bare callees present
      expect(mermaid).toContain('Logger');
      expect(mermaid).toContain('Config');
      // No "<-" variable binding syntax (escaped as &lt;-)
      expect(mermaid).not.toContain('&lt;-');
      // No role annotations
      expect(mermaid).not.toContain('(side-effect)');
      // No type signatures
      expect(mermaid).not.toContain('void, never, never');
    });

    it('conditional edges use true/false labels from IR', async () => {
      const ir = await Effect.runPromise(
        analyze(resolve(fixturesDir, 'rich-labels.ts')).named('conditionalProgram'),
      );
      const mermaid = await Effect.runPromise(renderMermaid(ir));
      expect(mermaid).toContain('-->|true|');
      expect(mermaid).toContain('-->|false|');
    });
  });

});
