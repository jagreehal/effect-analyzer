/**
 * Test Coverage Matrix Generator
 *
 * Generates a test coverage matrix from Effect paths, helping developers
 * ensure all paths through an Effect program are tested.
 */

import type {
  EffectPath,
  TestMatrix,
  TestPath,
  TestCondition,
  TestMatrixSummary,
} from '../types';

// =============================================================================
// Options
// =============================================================================

export interface TestMatrixOptions {
  /** Prefix for generated test names */
  testNamePrefix?: string;
  /** Function to customize test name generation */
  testNameGenerator?: (path: EffectPath) => string;
  /** Whether to include paths with loops (they may need special handling) */
  includeLoopPaths?: boolean;
}

const DEFAULT_OPTIONS: Required<TestMatrixOptions> = {
  testNamePrefix: 'should',
  testNameGenerator: defaultTestNameGenerator,
  includeLoopPaths: true,
};

// =============================================================================
// Main Generator
// =============================================================================

export function generateTestMatrix(
  paths: EffectPath[],
  options: TestMatrixOptions = {},
): TestMatrix {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let filteredPaths = paths;
  if (!opts.includeLoopPaths) {
    filteredPaths = paths.filter((p) => !p.hasLoops);
  }

  const testPaths = filteredPaths.map((path) => generateTestPath(path, opts));
  const conditions = extractConditions(filteredPaths);
  const summary = calculateSummary(testPaths, conditions);

  return {
    paths: testPaths,
    conditions,
    summary,
  };
}

// =============================================================================
// Test Path Generation
// =============================================================================

function generateTestPath(
  path: EffectPath,
  opts: Required<TestMatrixOptions>,
): TestPath {
  const testName = opts.testNameGenerator(path);
  const priority = determinePriority(path);

  const setupConditions = path.conditions.map((c) => {
    const verb = c.mustBe ? 'be truthy' : 'be falsy';
    return `Set up ${c.expression} to ${verb}`;
  });

  const expectedSteps = path.steps.map((s) => {
    const name = s.name ?? s.nodeId;
    return s.repeated ? `${name} (may repeat)` : name;
  });

  return {
    id: path.id,
    suggestedTestName: testName,
    description: path.description,
    setupConditions,
    expectedSteps,
    priority,
  };
}

function determinePriority(path: EffectPath): 'high' | 'medium' | 'low' {
  if (path.conditions.length === 0 && !path.hasLoops) {
    return 'high';
  }
  if (path.hasLoops && path.conditions.length > 2) {
    return 'low';
  }
  return 'medium';
}

function defaultTestNameGenerator(path: EffectPath): string {
  const parts: string[] = ['should'];

  if (path.steps.length > 0) {
    const mainSteps = path.steps.filter((s) => !s.repeated).slice(0, 3);
    if (mainSteps.length > 0) {
      const stepNames = mainSteps.map((s) =>
        camelToSpaces(s.name ?? s.nodeId),
      );
      parts.push(stepNames.join(' then '));
    }
  }

  if (path.conditions.length > 0) {
    parts.push('when');
    const conditionDescriptions = path.conditions.slice(0, 2).map((c) => {
      const simplified = simplifyCondition(c.expression);
      return c.mustBe ? simplified : `not ${simplified}`;
    });
    parts.push(conditionDescriptions.join(' and '));
  }

  if (path.hasLoops) {
    parts.push('(with iteration)');
  }

  return parts.join(' ');
}

function camelToSpaces(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

function simplifyCondition(expression: string): string {
  return expression
    .replace(/\s*===\s*true/g, '')
    .replace(/\s*===\s*false/g, ' is false')
    .replace(/\s*===\s*/g, ' is ')
    .replace(/\s*!==\s*/g, ' is not ')
    .replace(/\s*>\s*/g, ' greater than ')
    .replace(/\s*<\s*/g, ' less than ')
    .replace(/\s*>=\s*/g, ' at least ')
    .replace(/\s*<=\s*/g, ' at most ')
    .replace(/&&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .trim();
}

// =============================================================================
// Condition Extraction
// =============================================================================

function extractConditions(paths: EffectPath[]): TestCondition[] {
  const conditionMap = new Map<
    string,
    { whenTrue: string[]; whenFalse: string[] }
  >();

  for (const path of paths) {
    for (const condition of path.conditions) {
      const key = condition.expression;

      if (!conditionMap.has(key)) {
        conditionMap.set(key, { whenTrue: [], whenFalse: [] });
      }

      const entry = conditionMap.get(key);
      if (entry) {
        if (condition.mustBe) {
          entry.whenTrue.push(path.id);
        } else {
          entry.whenFalse.push(path.id);
        }
      }
    }
  }

  return Array.from(conditionMap.entries()).map(([expression, affected]) => ({
    expression,
    affectedPathsWhenTrue: affected.whenTrue,
    affectedPathsWhenFalse: affected.whenFalse,
  }));
}

// =============================================================================
// Summary
// =============================================================================

function calculateSummary(
  paths: TestPath[],
  conditions: TestCondition[],
): TestMatrixSummary {
  const highPriorityPaths = paths.filter((p) => p.priority === 'high').length;
  const minTestsForCoverage = Math.max(
    1,
    conditions.length * 2,
  );

  return {
    totalPaths: paths.length,
    highPriorityPaths,
    totalConditions: conditions.length,
    minTestsForCoverage,
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

export function formatTestMatrixMarkdown(matrix: TestMatrix): string {
  const lines: string[] = [];

  lines.push('# Test Coverage Matrix');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Paths:** ${matrix.summary.totalPaths}`);
  lines.push(`- **High Priority Paths:** ${matrix.summary.highPriorityPaths}`);
  lines.push(`- **Conditions to Test:** ${matrix.summary.totalConditions}`);
  lines.push(
    `- **Minimum Tests for Coverage:** ${matrix.summary.minTestsForCoverage}`,
  );
  lines.push('');

  lines.push('## Test Cases');
  lines.push('');

  const highPriority = matrix.paths.filter((p) => p.priority === 'high');
  const mediumPriority = matrix.paths.filter((p) => p.priority === 'medium');
  const lowPriority = matrix.paths.filter((p) => p.priority === 'low');

  if (highPriority.length > 0) {
    lines.push('### High Priority');
    lines.push('');
    for (const path of highPriority) {
      lines.push(...formatTestPathLines(path));
    }
    lines.push('');
  }

  if (mediumPriority.length > 0) {
    lines.push('### Medium Priority');
    lines.push('');
    for (const path of mediumPriority) {
      lines.push(...formatTestPathLines(path));
    }
    lines.push('');
  }

  if (lowPriority.length > 0) {
    lines.push('### Low Priority');
    lines.push('');
    for (const path of lowPriority) {
      lines.push(...formatTestPathLines(path));
    }
    lines.push('');
  }

  if (matrix.conditions.length > 0) {
    lines.push('## Conditions Coverage');
    lines.push('');
    lines.push('| Condition | Paths When True | Paths When False |');
    lines.push('|-----------|-----------------|------------------|');

    for (const condition of matrix.conditions) {
      const truncatedExpr =
        condition.expression.length > 40
          ? condition.expression.slice(0, 40) + '...'
          : condition.expression;
      const trueCount = condition.affectedPathsWhenTrue.length;
      const falseCount = condition.affectedPathsWhenFalse.length;
      lines.push(`| \`${truncatedExpr}\` | ${trueCount} | ${falseCount} |`);
    }
    lines.push('');
  }

  lines.push('## Test Checklist');
  lines.push('');
  for (const path of matrix.paths) {
    const priority =
      path.priority === 'high'
        ? 'HIGH'
        : path.priority === 'medium'
          ? 'MED'
          : 'LOW';
    lines.push(`- [ ] [${priority}] ${path.suggestedTestName}`);
  }
  lines.push('');

  return lines.join('\n');
}

function formatTestPathLines(path: TestPath): string[] {
  const lines: string[] = [];
  lines.push(`#### ${path.suggestedTestName}`);
  lines.push('');

  if (path.setupConditions.length > 0) {
    lines.push('**Setup:**');
    for (const condition of path.setupConditions) {
      lines.push(`- ${condition}`);
    }
    lines.push('');
  }

  lines.push('**Expected Steps:**');
  for (let i = 0; i < path.expectedSteps.length; i++) {
    lines.push(`${i + 1}. ${path.expectedSteps[i]}`);
  }
  lines.push('');

  return lines;
}

export function formatTestMatrixAsCode(
  matrix: TestMatrix,
  options: {
    testRunner?: 'vitest' | 'jest' | 'mocha';
    programName?: string;
  } = {},
): string {
  const runner = options.testRunner ?? 'vitest';
  const programName = options.programName ?? 'program';

  const lines: string[] = [];

  if (runner === 'vitest') {
    lines.push("import { describe, it, expect } from 'vitest';");
  } else if (runner === 'jest') {
    lines.push('// Jest test file');
  } else {
    lines.push("import { describe, it } from 'mocha';");
    lines.push("import { expect } from 'chai';");
  }

  lines.push('');
  lines.push(`describe('${programName}', () => {`);

  for (const path of matrix.paths) {
    lines.push('');
    lines.push(`  it('${escapeString(path.suggestedTestName)}', async () => {`);
    lines.push('    // Setup');
    for (const condition of path.setupConditions) {
      lines.push(`    // TODO: ${condition}`);
    }
    lines.push('');
    lines.push('    // Execute effect program');
    lines.push(`    // const result = await Effect.runPromise(${programName});`);
    lines.push('');
    lines.push('    // Verify expected steps executed');
    for (const step of path.expectedSteps) {
      lines.push(`    // TODO: Verify ${step} was executed`);
    }
    lines.push('  });');
  }

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

function escapeString(str: string): string {
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

export function formatTestChecklist(matrix: TestMatrix): string {
  const lines: string[] = [];

  lines.push('Test Coverage Checklist');
  lines.push('=======================');
  lines.push('');
  lines.push(`Total: ${matrix.summary.totalPaths} tests needed`);
  lines.push(`High Priority: ${matrix.summary.highPriorityPaths}`);
  lines.push('');

  for (const path of matrix.paths) {
    const marker =
      path.priority === 'high'
        ? '***'
        : path.priority === 'medium'
          ? '**'
          : '*';
    lines.push(`[ ] ${marker} ${path.suggestedTestName}`);
    if (path.setupConditions.length > 0) {
      lines.push(`    Conditions: ${path.setupConditions.join(', ')}`);
    }
  }

  return lines.join('\n');
}
