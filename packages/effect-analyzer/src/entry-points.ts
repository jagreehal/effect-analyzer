/**
 * Entry-point detector.
 *
 * Scans a TypeScript source file for the call expressions that launch an
 * Effect program at module load:
 *   - NodeRuntime.runMain(eff)
 *   - BunRuntime.runMain(eff)
 *   - Layer.launch(layer)            (long-running layer)
 *   - Effect.runFork(eff)            (fire-and-forget at top level)
 *   - Effect.runPromise[Exit](eff)   (when called at module scope, not inside another effect)
 *   - Effect.runSync(eff)            (when called at module scope)
 *
 * Inspired by patterns seen across effect-ts/examples (Http.ts, server.ts, bin.ts,
 * create-effect-app/Cli.ts). Each surfaced entry point answers the question:
 * "What runs when this file is imported?"
 */

import type { CallExpression, Node, SourceFile } from 'ts-morph';
import { Effect } from 'effect';
import {
  loadTsMorph,
  createProject,
  createProjectFromSource,
} from './ts-morph-loader';
import type { SourceLocation } from './types';
import { AnalysisError } from './types';
import { isJsOrJsxPath } from './analysis-utils';

export type EntryPointKind =
  | 'NodeRuntime.runMain'
  | 'BunRuntime.runMain'
  | 'Layer.launch'
  | 'Effect.runFork'
  | 'Effect.runPromise'
  | 'Effect.runPromiseExit'
  | 'Effect.runSync'
  | 'Effect.runSyncExit';

export interface EntryPoint {
  readonly kind: EntryPointKind;
  /** The full callee text e.g. "NodeRuntime.runMain" or "BunRuntime.runMain". */
  readonly callee: string;
  /** Text of the effect / layer argument (truncated to 120 chars). */
  readonly argText?: string;
  /** Whether the call appears at module scope (true) or nested inside another expression. */
  readonly isTopLevel: boolean;
  /** Source location of the call. */
  readonly location: SourceLocation;
}

export interface EntryPointReport {
  readonly filePath: string;
  readonly entryPoints: readonly EntryPoint[];
}

const ENTRY_POINT_CALLEES = new Map<string, EntryPointKind>([
  ['NodeRuntime.runMain', 'NodeRuntime.runMain'],
  ['BunRuntime.runMain', 'BunRuntime.runMain'],
  ['Layer.launch', 'Layer.launch'],
  ['Effect.runFork', 'Effect.runFork'],
  ['Effect.runPromise', 'Effect.runPromise'],
  ['Effect.runPromiseExit', 'Effect.runPromiseExit'],
  ['Effect.runSync', 'Effect.runSync'],
  ['Effect.runSyncExit', 'Effect.runSyncExit'],
]);

const isModuleScope = (node: Node): boolean => {
  const { SyntaxKind } = loadTsMorph();
  let cur: Node | undefined = node.getParent();
  while (cur) {
    const kind = cur.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.MethodDeclaration ||
      kind === SyntaxKind.ClassDeclaration
    ) {
      return false;
    }
    cur = cur.getParent();
  }
  return true;
};

const makeLocation = (call: CallExpression, filePath: string): SourceLocation => {
  const start = call.getStart();
  const { line, column } = call.getSourceFile().getLineAndColumnAtPos(start);
  return { filePath, line, column };
};

/** Scan a SourceFile for entry-point call expressions. */
export const findEntryPoints = (
  sf: SourceFile,
  filePath?: string,
): EntryPointReport => {
  const { SyntaxKind } = loadTsMorph();
  const fp = filePath ?? sf.getFilePath();
  const entryPoints: EntryPoint[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    const kind = ENTRY_POINT_CALLEES.get(callee);
    if (!kind) continue;
    const args = call.getArguments();
    const rawArg = args[0]?.getText();
    const argText =
      rawArg && rawArg.length > 120 ? `${rawArg.slice(0, 120)}…` : rawArg;
    entryPoints.push({
      kind,
      callee,
      ...(argText ? { argText } : {}),
      isTopLevel: isModuleScope(call),
      location: makeLocation(call, fp),
    });
  }
  return { filePath: fp, entryPoints };
};

/** Convenience: scan a file path. */
export const analyzeEntryPointsFile = (
  filePath: string,
): Effect.Effect<EntryPointReport, AnalysisError> =>
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
    return findEntryPoints(sf, filePath);
  });

/** Convenience: scan a source string. */
export const analyzeEntryPointsSource = (
  code: string,
  filePath = 'temp.ts',
): EntryPointReport => {
  const sf = createProjectFromSource(code, filePath);
  return findEntryPoints(sf, filePath);
};
