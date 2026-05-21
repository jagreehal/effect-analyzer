/**
 * Config sensitivity analyzer.
 *
 * Tracks `Config.redacted` and `Config.secret` calls and flags places where
 * the resulting variable flows into `Effect.log*`, `console.*`, or other
 * obvious leak sinks. Best-effort dataflow: we follow direct variable bindings
 * (const NAME = Config.redacted("X")) and look for references in argument
 * positions of leak-sink calls within the same SourceFile.
 *
 * This is intentionally heuristic — strict redacted-value tracking lives in
 * the Effect runtime's Redacted type. Static analysis can catch the common
 * "I forgot to wrap before logging" mistake.
 */

import type { CallExpression, Identifier, Node, SourceFile } from 'ts-morph';
import { Effect } from 'effect';
import { loadTsMorph, createProject, createProjectFromSource } from './ts-morph-loader';
import type { SourceLocation } from './types';
import { AnalysisError } from './types';
import { isJsOrJsxPath } from './analysis-utils';

export interface ConfigSource {
  /** Variable name (e.g. "apiKey") if bound via const/let. */
  readonly variableName?: string | undefined;
  /** Underlying call text (e.g. 'Config.redacted("API_KEY")'). */
  readonly callText: string;
  /** Sensitivity classification. */
  readonly sensitivity: 'redacted' | 'secret';
  /** Source location of the Config call. */
  readonly location: SourceLocation;
}

export interface ConfigLeak {
  /** Name of the redacted/secret variable being passed to a sink. */
  readonly variableName: string;
  /** Sink callee (e.g. "Effect.logError" / "console.log"). */
  readonly sinkCallee: string;
  /** Source location of the sink call. */
  readonly location: SourceLocation;
}

export interface ConfigSensitivityReport {
  readonly filePath: string;
  readonly sources: readonly ConfigSource[];
  readonly leaks: readonly ConfigLeak[];
}

const LEAK_CALLEE_PREFIXES = ['Effect.log', 'console.'];

const isLeakCallee = (text: string): boolean =>
  LEAK_CALLEE_PREFIXES.some((p) => text.startsWith(p));

const makeLocation = (node: Node, filePath: string): SourceLocation => {
  const start = node.getStart();
  const { line, column } = node.getSourceFile().getLineAndColumnAtPos(start);
  return { filePath, line, column };
};

export const findConfigSensitivity = (
  sf: SourceFile,
  filePath?: string,
): ConfigSensitivityReport => {
  const { SyntaxKind } = loadTsMorph();
  const fp = filePath ?? sf.getFilePath();
  const sources: ConfigSource[] = [];
  // variableName -> sensitivity (for downstream leak check)
  const sensitiveByName = new Map<string, 'redacted' | 'secret'>();

  // 1) Find Config.redacted / Config.secret calls and map them to variable names
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    let sensitivity: 'redacted' | 'secret' | undefined;
    if (callee === 'Config.redacted') sensitivity = 'redacted';
    else if (callee === 'Config.secret') sensitivity = 'secret';
    if (!sensitivity) continue;

    // Walk up to find a containing VariableDeclaration; that's our binding.
    let variableName: string | undefined;
    let cur: Node | undefined = call.getParent();
    while (cur) {
      if (cur.getKind() === SyntaxKind.VariableDeclaration) {
        const name = (cur as { getName?: () => string }).getName?.();
        if (name) variableName = name;
        break;
      }
      cur = cur.getParent();
    }

    sources.push({
      variableName,
      callText: call.getText(),
      sensitivity,
      location: makeLocation(call, fp),
    });
    if (variableName) sensitiveByName.set(variableName, sensitivity);
  }

  // 2) Look for references to sensitive variables passed to log/console sinks.
  const leaks: ConfigLeak[] = [];
  if (sensitiveByName.size > 0) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const calleeText = call.getExpression().getText();
      if (!isLeakCallee(calleeText)) continue;
      for (const arg of call.getArguments()) {
        // Look at identifiers anywhere inside each argument.
        const ids = arg.getDescendantsOfKind(SyntaxKind.Identifier);
        const direct = arg.getKind() === SyntaxKind.Identifier ? [arg as Identifier] : [];
        for (const id of [...direct, ...ids]) {
          const name = id.getText();
          if (!sensitiveByName.has(name)) continue;
          leaks.push({
            variableName: name,
            sinkCallee: calleeText,
            location: makeLocation(call, fp),
          });
          break; // one leak per arg is enough
        }
      }
    }
  }

  return { filePath: fp, sources, leaks };
};

export const analyzeConfigSensitivityFile = (
  filePath: string,
): Effect.Effect<ConfigSensitivityReport, AnalysisError> =>
  Effect.gen(function* () {
    const { Project } = loadTsMorph();
    const project = yield* Effect.try({
      try: () =>
        isJsOrJsxPath(filePath)
          ? new Project({
              skipAddingFilesFromTsConfig: true,
              compilerOptions: { allowJs: true },
            })
          : createProject(),
      catch: (error) =>
        new AnalysisError(
          'PROJECT_CREATION_FAILED',
          `Failed to create project: ${String(error)}`,
        ),
    });
    const sf = yield* Effect.try({
      try: () => {
        const existing = project.getSourceFile(filePath);
        if (existing) return existing;
        return project.addSourceFileAtPath(filePath);
      },
      catch: (error) =>
        new AnalysisError(
          'FILE_NOT_FOUND',
          `Failed to load file ${filePath}: ${String(error)}`,
        ),
    });
    return findConfigSensitivity(sf, filePath);
  });

export const analyzeConfigSensitivitySource = (
  code: string,
  filePath = 'temp.ts',
): ConfigSensitivityReport => {
  const sf = createProjectFromSource(code, filePath);
  return findConfigSensitivity(sf, filePath);
};

// Avoid unused-import warning if CallExpression is only referenced in JSDoc.
void (null as unknown as CallExpression);
