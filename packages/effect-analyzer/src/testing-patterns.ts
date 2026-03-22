/**
 * Testing Pattern Analysis (GAP 16)
 *
 * Detects TestClock, TestContext, mock layers, and test entry points.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface TestingPatternAnalysis {
  readonly testClockUsed: boolean;
  readonly testContextUsed: boolean;
  readonly mockLayers: string[];
  readonly runInTests: boolean;
  readonly effectVitestUsed: boolean;
  readonly effectVitestImported: boolean;
  readonly sharedLayerUsed: boolean;
  readonly testAnnotationsUsed: boolean;
  readonly flakyTestUsed: boolean;
  readonly exitAssertionsUsed: boolean;
  readonly testServicesUsed: boolean;
  readonly fastCheckUsed: boolean;
  readonly propertyTestUsed: boolean;
  readonly locations: Map<string, SourceLocation>;
}

function getLoc(
  filePath: string,
  node: { getStart: () => number },
  sf: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const { line, column } = sf.getLineAndColumnAtPos(node.getStart());
  return { filePath, line: line + 1, column };
}

/**
 * Analyze a file for Effect testing patterns.
 */
export function analyzeTestingPatterns(
  filePath: string,
  source?: string,
): TestingPatternAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);
  const locations = new Map<string, SourceLocation>();
  let testClockUsed = false;
  let testContextUsed = false;
  const mockLayers: string[] = [];
  let runInTests = false;
  let effectVitestUsed = false;
  let effectVitestImported = false;
  let sharedLayerUsed = false;
  let testAnnotationsUsed = false;
  let flakyTestUsed = false;
  let exitAssertionsUsed = false;
  let testServicesUsed = false;
  let fastCheckUsed = false;
  let propertyTestUsed = false;

  // Check for @effect/vitest import and fast-check/fc imports
  for (const decl of sf.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier === '@effect/vitest' || specifier.includes('@effect/vitest')) {
      effectVitestImported = true;
    }
    if (specifier === 'fast-check' || specifier === 'fc' || specifier.includes('fast-check')) {
      fastCheckUsed = true;
      locations.set('fast-check', { filePath, line: 1, column: 0 });
    }
  }

  for (const node of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression().getText();
    const loc = getLoc(filePath, node, sf);
    if (expr.includes('TestClock') || expr.includes('TestContext')) {
      if (expr.includes('TestClock')) testClockUsed = true;
      if (expr.includes('TestContext')) testContextUsed = true;
      locations.set('test-context', getLoc(filePath, node, sf));
    }
    if (
      (expr.includes('Layer.succeed') || expr.includes('Layer.mock')) &&
      (node.getParent()?.getText().includes('test') || sf.getFilePath().includes('.test.'))
    ) {
      mockLayers.push(expr.slice(0, 60));
      locations.set('mock-layer', getLoc(filePath, node, sf));
    }
    if (
      expr.includes('Effect.runPromise') ||
      expr.includes('Effect.runSync') ||
      expr.includes('Effect.runPromiseExit') ||
      expr.includes('Effect.runSyncExit') ||
      expr.includes('runPromise') ||
      expr.includes('runSync')
    ) {
      if (sf.getFilePath().includes('.test.') || sf.getFilePath().includes('spec.')) runInTests = true;
    }
    if (
      expr.includes('it.effect') ||
      expr.includes('it.scoped') ||
      expr.includes('it.live') ||
      expr.includes('it.scopedLive') ||
      expr.includes('it.prop')
    ) {
      effectVitestUsed = true;
      if (expr.includes('it.prop')) propertyTestUsed = true;
      locations.set('effect-vitest', loc);
    }
    if (expr.includes('TestAnnotations')) {
      testAnnotationsUsed = true;
      locations.set('test-annotations', loc);
    }
    if (expr.includes('flakyTest')) {
      flakyTestUsed = true;
      locations.set('flaky-test', loc);
    }
    if (expr.includes('Exit.match') || expr.includes('Exit.isSuccess') || expr.includes('Exit.isFailure') || expr.includes('Exit.isInterrupted')) {
      exitAssertionsUsed = true;
      locations.set('exit-assertions', loc);
    }
    // Detect shared layer pattern: layer(MyLayer)("suite", fn)
    if (
      (expr === 'layer' || expr.endsWith('.layer')) &&
      node.getParent()?.getText().includes('(')
    ) {
      sharedLayerUsed = true;
      locations.set('shared-layer', loc);
    }
    // TestServices.* — live/sized/annotations service overrides
    if (expr.includes('TestServices') || expr.includes('TestSized') || expr.includes('TestLive')) {
      testServicesUsed = true;
      locations.set('test-services', loc);
    }
    // FastCheck / Arbitrary usage
    if (
      expr.includes('fc.') ||
      expr.includes('FastCheck') ||
      expr.includes('Arbitrary.make') ||
      expr.includes('Arbitrary.filter') ||
      expr.includes('Arbitrary.from')
    ) {
      fastCheckUsed = true;
      locations.set('fast-check', loc);
    }
    // Property-based tests via it.prop or fc.property
    if (expr.includes('fc.property') || expr.includes('fc.asyncProperty')) {
      propertyTestUsed = true;
      locations.set('property-test', loc);
    }
  }

  return {
    testClockUsed,
    testContextUsed,
    mockLayers: [...new Set(mockLayers)],
    runInTests,
    effectVitestUsed,
    effectVitestImported,
    sharedLayerUsed,
    testAnnotationsUsed,
    flakyTestUsed,
    exitAssertionsUsed,
    testServicesUsed,
    fastCheckUsed,
    propertyTestUsed,
    locations,
  };
}
