/**
 * Config Module Analysis (GAP 9)
 *
 * Detects Effect Config / ConfigProvider usage.
 */

import { Project, SyntaxKind } from 'ts-morph';
import type { SourceLocation } from './types';

// =============================================================================
// Types
// =============================================================================

export interface ConfigItem {
  readonly key: string;
  readonly type:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'date'
    | 'duration'
    | 'url'
    | 'port'
    | 'logLevel'
    | 'literal'
    | 'array'
    | 'map'
    | 'nested'
    | 'secret'
    | 'unknown';
  readonly required: boolean;
  readonly hasDefault: boolean;
  readonly location?: SourceLocation;
}

export interface ConfigCombinator {
  readonly kind:
    | 'map'
    | 'mapAttempt'
    | 'mapOrFail'
    | 'orElse'
    | 'orElseIf'
    | 'withDefault'
    | 'withDescription'
    | 'validate'
    | 'repeat'
    | 'option';
  readonly location?: SourceLocation;
}

export interface ConfigAnalysis {
  readonly requiredConfigs: ConfigItem[];
  readonly optionalConfigs: ConfigItem[];
  readonly secretConfigs: ConfigItem[];
  readonly providerOverrides: string[];
  readonly envVarHints: Map<string, string>;
  readonly combinators: ConfigCombinator[];
}

// =============================================================================
// Detection
// =============================================================================

function getLocation(
  filePath: string,
  node: { getStart: () => number },
  sourceFile: { getLineAndColumnAtPos: (p: number) => { line: number; column: number } },
): SourceLocation {
  const offset = node.getStart();
  const { line, column } = sourceFile.getLineAndColumnAtPos(offset);
  return { filePath, line: line + 1, column, offset };
}

/**
 * Analyze a TypeScript file for Effect Config usage.
 */
export function analyzeConfig(
  filePath: string,
  source?: string,
): ConfigAnalysis {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = source
    ? project.createSourceFile(filePath, source)
    : project.addSourceFileAtPath(filePath);

  const requiredConfigs: ConfigItem[] = [];
  const optionalConfigs: ConfigItem[] = [];
  const secretConfigs: ConfigItem[] = [];
  const providerOverrides: string[] = [];
  const envVarHints = new Map<string, string>();
  const combinators: ConfigCombinator[] = [];

  for (const node of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = node.getExpression();
    const text = expr.getText();
    const loc = getLocation(filePath, node, sourceFile);
    const args = node.getArguments();
    const keyArg = args[0];
    const key = keyArg?.getText().replace(/["'`]/g, '').trim() ?? 'unknown';
    const parentText = node.getParent()?.getText() ?? '';
    const hasDefault = parentText.includes('withDefault');
    const envKey = key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    envVarHints.set(key, envKey);

    const configType = (
      text.includes('Config.nonEmptyString') ? 'string' :
      text.includes('Config.string') ? 'string' :
      text.includes('Config.integer') ? 'integer' :
      text.includes('Config.number') ? 'number' :
      text.includes('Config.boolean') ? 'boolean' :
      text.includes('Config.date') ? 'date' :
      text.includes('Config.duration') ? 'duration' :
      text.includes('Config.url') ? 'url' :
      text.includes('Config.port') ? 'port' :
      text.includes('Config.logLevel') ? 'logLevel' :
      text.includes('Config.literal') ? 'literal' :
      text.includes('Config.array') || text.includes('Config.chunk') ? 'array' :
      text.includes('Config.hashSet') || text.includes('Config.hashMap') ? 'map' :
      text.includes('Config.nested') || text.includes('Config.all') ? 'nested' :
      undefined
    );

    if (configType !== undefined) {
      const item: ConfigItem = {
        key,
        type: configType,
        required: !hasDefault,
        hasDefault,
        location: loc,
      };
      if (hasDefault || parentText.includes('Config.option')) optionalConfigs.push(item);
      else requiredConfigs.push(item);
    } else if (text === 'Config.secret' || text === 'Config.redacted' || (text.includes('Config.secret') || text.includes('Config.redacted'))) {
      secretConfigs.push({ key, type: 'secret', required: true, hasDefault: false, location: loc });
    }

    if (
      text.includes('Effect.withConfigProvider') ||
      text.includes('Layer.setConfigProvider')
    ) {
      providerOverrides.push(text);
    }

    // Detect Config combinators (wrapping transforms / fallbacks)
    const COMBINATOR_MAP: [string, ConfigCombinator['kind']][] = [
      ['Config.mapOrFail', 'mapOrFail'],
      ['Config.mapAttempt', 'mapAttempt'],
      ['Config.map', 'map'],
      ['Config.orElseIf', 'orElseIf'],
      ['Config.orElse', 'orElse'],
      ['Config.withDefault', 'withDefault'],
      ['Config.withDescription', 'withDescription'],
      ['Config.validate', 'validate'],
      ['Config.repeat', 'repeat'],
      ['Config.option', 'option'],
    ];
    for (const [pattern, kind] of COMBINATOR_MAP) {
      if (text === pattern || text.startsWith(pattern + '(') || text.startsWith(pattern + '<')) {
        combinators.push({ kind, location: loc });
        break;
      }
    }
  }

  return {
    requiredConfigs,
    optionalConfigs,
    secretConfigs,
    providerOverrides: [...new Set(providerOverrides)],
    envVarHints,
    combinators,
  };
}

/**
 * Format config analysis as a markdown table.
 */
export function formatConfigReport(analysis: ConfigAnalysis): string {
  const lines: string[] = ['| Config Key | Type | Required | Default | Secret |', '|------------|------|----------|---------|--------|'];
  const all = [
    ...analysis.requiredConfigs,
    ...analysis.optionalConfigs,
    ...analysis.secretConfigs,
  ];
  const seen = new Set<string>();
  for (const c of all) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    const req = c.required ? 'yes' : 'no';
    const def = c.hasDefault ? 'yes' : '-';
    const secret = analysis.secretConfigs.some((s) => s.key === c.key) ? 'yes' : 'no';
    lines.push(`| ${c.key} | ${c.type} | ${req} | ${def} | ${secret} |`);
  }
  lines.push('');
  lines.push(`Total: ${seen.size} config key(s)`);
  if (analysis.providerOverrides.length > 0) {
    lines.push(`Config providers: ${analysis.providerOverrides.length}`);
  }
  if (analysis.combinators.length > 0) {
    const byKind = new Map<string, number>();
    for (const c of analysis.combinators) {
      byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    }
    const combSummary = Array.from(byKind.entries())
      .map(([k, n]) => `${k}(×${n})`)
      .join(', ');
    lines.push(`Config combinators: ${combSummary}`);
  }
  return lines.join('\n');
}
