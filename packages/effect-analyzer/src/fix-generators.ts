/**
 * Fix Generators — code fix templates for common lint rules.
 *
 * Each fix generator takes the relevant source context and returns a
 * code replacement that can be applied by a coding agent.
 */

import type { LintFinding } from './lint-session';

// =============================================================================
// Fix types
// =============================================================================

export interface CodeFix {
  readonly rule: string;
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly description: string;
  readonly before: string;
  readonly after: string;
  readonly confidence: 'high' | 'medium' | 'low';
}

// =============================================================================
// Fix generators by rule
// =============================================================================

/**
 * Generate a fix for effect-fail-untagged.
 * Transforms: Effect.fail(new Error("msg"))
 * Into: Effect.fail(new MyError({ message: "msg" }))
 * with a TaggedError class definition.
 */
export const generateEffectFailUntaggedFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  // Extract the error message from the source
  const msgMatch = /new\s+Error\(["'](.+?)["']\)/.exec(sourceLine);
  if (!msgMatch) return undefined;

  const errorName = deriveErrorName(finding.message);

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: `Replace Effect.fail(new Error(...)) with tagged error class "${errorName}"`,
    before: sourceLine.trim(),
    after: sourceLine
      .replace(/new\s+Error\(["'](.+?)["']\)/, `new ${errorName}({ message: "$1" })`)
      .replace(/new\s+TypeError\(["'](.+?)["']\)/, `new ${errorName}({ message: "$1" })`)
      .replace(/new\s+RangeError\(["'](.+?)["']\)/, `new ${errorName}({ message: "$1" })`),
    confidence: 'medium',
  };
};

/**
 * Generate a fix for raw-side-effect-in-gen (process.env).
 * Transforms: process.env.MY_VAR
 * Into: yield* Config.string("MY_VAR")
 */
export const generateRawSideEffectFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  const envMatch = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/.exec(sourceLine);
  if (!envMatch) return undefined;

  const varName = envMatch[1];

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: `Replace process.env.${varName} with Config.string("${varName}")`,
    before: sourceLine.trim(),
    after: sourceLine.replace(
      /process\.env\.[A-Za-z_][A-Za-z0-9_]*/,
      `yield* Config.string("${varName}")`,
    ),
    confidence: 'medium',
  };
};

/**
 * Generate a fix for array-push-spread.
 * Transforms: arr.push(...xs)
 * Into: for (const x of xs) arr.push(x)
 */
export const generateArrayPushSpreadFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  const match = /(\w+)\.push\(\.\.\.(\w+)\)/.exec(sourceLine);
  if (!match) return undefined;

  const [, arr, xs] = match;

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: `Replace ${arr}.push(...${xs}) with loop`,
    before: sourceLine.trim(),
    after: `for (const item of ${xs}) ${arr}.push(item);`,
    confidence: 'high',
  };
};

/**
 * Generate a fix for schedule-unbounded.
 * Transforms: Schedule.spaced(ms) or Schedule.forever
 * Into: Schedule.spaced(ms).pipe(Schedule.recurs(maxRetries))
 */
export const generateScheduleUnboundedFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  if (sourceLine.includes('Schedule.forever')) {
    return {
      rule: finding.rule,
      filePath: finding.filePath,
      line: finding.line,
      column: finding.column,
      description: 'Replace Schedule.forever with bounded schedule',
      before: sourceLine.trim(),
      after: sourceLine.replace('Schedule.forever', 'Schedule.recurs(3)'),
      confidence: 'medium',
    };
  }

  const spacedMatch = /Schedule\.spaced\(([^)]+)\)/.exec(sourceLine);
  if (spacedMatch) {
    const duration = spacedMatch[1];
    return {
      rule: finding.rule,
      filePath: finding.filePath,
      line: finding.line,
      column: finding.column,
      description: 'Bound Schedule.spaced with recurs',
      before: sourceLine.trim(),
      after: sourceLine.replace(
        /Schedule\.spaced\([^)]+\)/,
        `Schedule.spaced(${duration}).pipe(Schedule.recurs(3))`,
      ),
      confidence: 'medium',
    };
  }

  return undefined;
};

/**
 * Generate a fix for console-log-in-effect.
 * Transforms: console.log("msg")
 * Into: yield* Effect.log("msg")
 */
export const generateConsoleLogFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  const methodMatch = /console\.(log|info|warn|error|debug)\((.+)\)/.exec(sourceLine);
  if (!methodMatch) return undefined;

  const [, method, args] = methodMatch;
  const effectLog = method === 'warn'
    ? 'Effect.logWarning'
    : method === 'error'
      ? 'Effect.logError'
      : method === 'debug'
        ? 'Effect.logDebug'
        : method === 'info'
          ? 'Effect.logInfo'
          : 'Effect.log';

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: `Replace console.${method} with ${effectLog}`,
    before: sourceLine.trim(),
    after: sourceLine.replace(
      /console\.(log|info|warn|error|debug)\((.+)\)/,
      `yield* ${effectLog}(${args})`,
    ),
    confidence: 'high',
  };
};

/**
 * Generate a fix for promise-api-in-gen.
 * Transforms: Promise.all([...])
 * Into: Effect.all([...])
 */
export const generatePromiseApiFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  const replacements: Record<string, string> = {
    'Promise.all': 'Effect.all',
    'Promise.allSettled': 'Effect.all',
    'Promise.race': 'Effect.race',
    'Promise.resolve': 'Effect.succeed',
    'Promise.reject': 'Effect.fail',
  };

  for (const [from, to] of Object.entries(replacements)) {
    if (sourceLine.includes(from)) {
      return {
        rule: finding.rule,
        filePath: finding.filePath,
        line: finding.line,
        column: finding.column,
        description: `Replace ${from} with ${to}`,
        before: sourceLine.trim(),
        after: sourceLine.replace(from, to),
        confidence: 'high',
      };
    }
  }

  return undefined;
};

/**
 * Generate a fix for identity-catch.
 * Removes identity catch handlers entirely.
 */
export const generateIdentityCatchFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  // Match .catchAll((e) => Effect.fail(e)) or .catchTag("X", (e) => Effect.fail(e))
  const match = /\.catch(All|Tag|AllCause|AllDefect)\(([^)]+)\)/.exec(sourceLine);
  if (!match) return undefined;

  const [, method, handler] = match;
  if (!handler) return undefined;
  const handlerText = handler.trim();

  // Check if it's an identity handler
  const isIdentity =
    /^\(\s*\w+\s*\)\s*=>\s*Effect\.fail\(\w+\)$/.test(handlerText) ||
    /^\(\s*\w+\s*\)\s*=>\s*Effect\.failCause\(\w+\)$/.test(handlerText);

  if (!isIdentity) return undefined;

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: 'Remove identity catch handler',
    before: sourceLine.trim(),
    after: sourceLine.replace(new RegExp(`\\.catch${method}\\(${handlerText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`), ''),
    confidence: 'high',
  };
};

/**
 * Generate a fix for config-secret-without-redacted.
 * Transforms: Config.string("password")
 * Into: Config.redacted("password")
 */
export const generateConfigSecretFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  const match = /Config\.(string|nonEmptyString|secret)\((["'][^"']+["'])\)/.exec(sourceLine);
  if (!match) return undefined;

  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: 'Replace Config.string with Config.redacted for secret',
    before: sourceLine.trim(),
    after: sourceLine.replace(
      /Config\.(string|nonEmptyString|secret)\((["'][^"']+["'])\)/,
      'Config.redacted($2)',
    ),
    confidence: 'high',
  };
};

/**
 * Generate a fix for forEach-without-concurrency.
 * Adds explicit concurrency option.
 */
export const generateForEachConcurrencyFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  if (sourceLine.includes('Effect.forEach') && !sourceLine.includes('concurrency')) {
    // Two-arg form: Effect.forEach(iterable, fn)
    // Add third arg: { concurrency: "unbounded" }
    return {
      rule: finding.rule,
      filePath: finding.filePath,
      line: finding.line,
      column: finding.column,
      description: 'Add explicit concurrency option to Effect.forEach',
      before: sourceLine.trim(),
      after: sourceLine.replace(
        /(Effect\.forEach\([^,]+,\s*[^)]+)\)/,
        '$1, { concurrency: "unbounded" })',
      ),
      confidence: 'medium',
    };
  }

  return undefined;
};

/**
 * Generate a fix for catchAll-vs-catchTag.
 * Transforms: .catchAll((e) => ...)
 * Into: .catchTag("ErrorTag", (e) => ...)
 * (Requires knowing the error tag — uses heuristic from message)
 */
export const generateCatchTagFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  // This is a suggestion-only fix since we need type info to know the tag
  return {
    rule: finding.rule,
    filePath: finding.filePath,
    line: finding.line,
    column: finding.column,
    description: 'Consider using catchTag instead of catchAll for tagged errors',
    before: sourceLine.trim(),
    after: sourceLine.replace(
      /\.catchAll\(/,
      '.catchTag("ErrorTag", ',
    ),
    confidence: 'low',
  };
};

// =============================================================================
// Main fix generator
// =============================================================================

/**
 * Generate a code fix for a lint finding, if possible.
 */
export const generateFix = (
  finding: LintFinding,
  sourceLine: string,
): CodeFix | undefined => {
  switch (finding.rule) {
    case 'effect-fail-untagged':
      return generateEffectFailUntaggedFix(finding, sourceLine);
    case 'raw-side-effect-in-gen':
      return generateRawSideEffectFix(finding, sourceLine);
    case 'array-push-spread':
      return generateArrayPushSpreadFix(finding, sourceLine);
    case 'schedule-unbounded':
      return generateScheduleUnboundedFix(finding, sourceLine);
    case 'console-log-in-effect':
      return generateConsoleLogFix(finding, sourceLine);
    case 'promise-api-in-gen':
      return generatePromiseApiFix(finding, sourceLine);
    case 'identity-catch':
      return generateIdentityCatchFix(finding, sourceLine);
    case 'config-secret-without-redacted':
      return generateConfigSecretFix(finding, sourceLine);
    case 'forEach-without-concurrency':
      return generateForEachConcurrencyFix(finding, sourceLine);
    case 'catchAll-vs-catchTag':
      return generateCatchTagFix(finding, sourceLine);
    default:
      return undefined;
  }
};

/**
 * Generate fixes for all findings that have fixable rules.
 */
export const generateAllFixes = (
  findings: readonly LintFinding[],
  sourceLines: ReadonlyMap<string, readonly string[]>,
): readonly CodeFix[] => {
  const fixes: CodeFix[] = [];

  for (const finding of findings) {
    const lines = sourceLines.get(finding.filePath);
    if (!lines) continue;
    const sourceLine = lines[finding.line - 1];
    if (!sourceLine) continue;

    const fix = generateFix(finding, sourceLine);
    if (fix) {
      fixes.push(fix);
    }
  }

  return fixes;
};

// =============================================================================
// Helpers
// =============================================================================

const deriveErrorName = (message: string): string => {
  // Extract context from the message to derive a meaningful error name
  const contextMatch = /Effect\.(fail|failSync)/.exec(message);
  if (!contextMatch) return 'AppError';

  // Look for operation context in the message
  const opMatch = /"(.*?)"/.exec(message);
  if (opMatch && opMatch[1]) {
    const words = opMatch[1].split(/[\s_-]+/);
    const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    return `${name}Error`;
  }

  return 'AppError';
};

/**
 * Render fixes as a unified diff.
 */
export const renderFixesAsDiff = (fixes: readonly CodeFix[]): string => {
  const lines: string[] = [];

  for (const fix of fixes) {
    lines.push(`--- a/${fix.filePath}`);
    lines.push(`+++ b/${fix.filePath}`);
    lines.push(`@@ -${fix.line},${fix.line} +${fix.line},${fix.line} @@`);
    lines.push(`-${fix.before}`);
    lines.push(`+${fix.after}`);
    lines.push('');
  }

  return lines.join('\n');
};

/**
 * Render fixes as JSON for agent consumption.
 */
export const renderFixesAsJson = (fixes: readonly CodeFix[], pretty = true): string =>
  JSON.stringify(fixes, null, pretty ? 2 : 0);
