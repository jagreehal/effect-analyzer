/**
 * CLI command structure analyzer.
 *
 * Detects @effect/cli usage:
 *   - Command.make("name", { options })
 *   - .pipe(Command.withHandler(fn))
 *   - .pipe(Command.withSubcommands([sub1, sub2]))
 *   - Args.text / Args.integer / Args.choice / ...
 *   - Options.text / Options.boolean / Options.integer / Options.choice / ...
 *   - Prompt.text / Prompt.select / Prompt.toggle / ...
 *   - Command.run(rootCommand, { name, version })
 *
 * Produces a compact tree of CLI structure useful for documentation and
 * diagram generation.
 */

import type {
  CallExpression,
  Identifier,
  Node,
  SourceFile,
  ArrayLiteralExpression,
  ObjectLiteralExpression,
  PropertyAssignment,
  StringLiteral,
} from 'ts-morph';
import { Effect } from 'effect';
import {
  loadTsMorph,
  createProject,
  createProjectFromSource,
} from './ts-morph-loader';
import type { SourceLocation } from './types';
import { AnalysisError } from './types';
import { isJsOrJsxPath } from './analysis-utils';

export interface CliArgInfo {
  /** Kind of input (text, integer, choice, boolean, etc.). */
  readonly kind: string;
  /** First argument text (often the flag/name). */
  readonly nameOrLabel?: string | undefined;
}

export interface CliPromptInfo {
  /** Kind of prompt (text, select, toggle, list, ...). */
  readonly kind: string;
  /** First argument text (label/message). */
  readonly nameOrLabel?: string | undefined;
}

export interface CliCommandInfo {
  /** Command name as passed to Command.make("name", ...). */
  readonly name: string;
  /** Source location of the Command.make call. */
  readonly location: SourceLocation;
  /** Options (--foo) parsed from the second argument shape. */
  readonly options: readonly CliArgInfo[];
  /** Positional args. */
  readonly args: readonly CliArgInfo[];
  /** Prompts referenced from this command's containing module. */
  readonly prompts: readonly CliPromptInfo[];
  /** Whether a .pipe(Command.withHandler(...)) is present in the same statement chain. */
  readonly hasHandler: boolean;
  /** Subcommands names referenced via Command.withSubcommands ([...]). */
  readonly subcommandNames: readonly string[];
}

export interface CliRunInfo {
  readonly rootCommand?: string | undefined;
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly location: SourceLocation;
}

export interface CliCommandReport {
  readonly filePath: string;
  readonly commands: readonly CliCommandInfo[];
  readonly runs: readonly CliRunInfo[];
}

const makeLocation = (node: Node, filePath: string): SourceLocation => {
  const start = node.getStart();
  const { line, column } = node.getSourceFile().getLineAndColumnAtPos(start);
  return { filePath, line, column };
};

const isArgsCallee = (callee: string): boolean =>
  /^(?:Args|@effect\/cli\.Args)\.[A-Za-z]+$/.test(callee);
const isOptionsCallee = (callee: string): boolean =>
  /^(?:Options|@effect\/cli\.Options)\.[A-Za-z]+$/.test(callee);
const isPromptCallee = (callee: string): boolean =>
  /^Prompt\.[A-Za-z]+$/.test(callee);

const trimText = (s: string, n = 64): string =>
  s.length <= n ? s : `${s.slice(0, n)}…`;

const calleeOf = (call: CallExpression): string => call.getExpression().getText();

/**
 * Extract argument info (kind + first-arg text) from an Args.* / Options.* / Prompt.* call.
 */
const argInfoFromCall = (call: CallExpression): CliArgInfo => {
  const callee = calleeOf(call);
  const kind = callee.split('.').pop() ?? callee;
  const args = call.getArguments();
  const first = args[0]?.getText();
  return {
    kind,
    nameOrLabel: first ? trimText(first) : undefined,
  };
};

/**
 * Inspect the second arg of Command.make (the option-shape object literal)
 * and gather Args / Options calls contained within.
 */
const collectArgsAndOptions = (
  call: CallExpression,
): { args: CliArgInfo[]; options: CliArgInfo[] } => {
  const { SyntaxKind } = loadTsMorph();
  const args: CliArgInfo[] = [];
  const options: CliArgInfo[] = [];
  const second = call.getArguments()[1];
  if (!second) return { args, options };
  if (second.getKind() !== SyntaxKind.ObjectLiteralExpression) return { args, options };

  for (const prop of (second as ObjectLiteralExpression).getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const init = (prop as PropertyAssignment).getInitializer();
    if (!init) continue;
    // Walk through the initializer for any Args.* / Options.* calls.
    for (const c of init.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = calleeOf(c);
      if (isArgsCallee(callee)) args.push(argInfoFromCall(c));
      else if (isOptionsCallee(callee)) options.push(argInfoFromCall(c));
    }
    // If the initializer itself is a call:
    if (init.getKind() === SyntaxKind.CallExpression) {
      const callee = calleeOf(init as CallExpression);
      if (isArgsCallee(callee)) args.push(argInfoFromCall(init as CallExpression));
      else if (isOptionsCallee(callee)) options.push(argInfoFromCall(init as CallExpression));
    }
  }
  return { args, options };
};

/** Look for `.pipe(Command.withHandler(...))` chained on the Command.make call. */
const hasWithHandler = (call: CallExpression, sf: SourceFile): boolean => {
  const text = sf.getText();
  const callText = call.getText();
  const idx = text.indexOf(callText);
  if (idx < 0) return false;
  const tail = text.slice(idx, idx + callText.length + 400);
  return /Command\.withHandler\s*\(/.test(tail);
};

const subcommandNamesFromCall = (call: CallExpression): string[] => {
  const { SyntaxKind } = loadTsMorph();
  const text = call.getText();
  if (!text.includes('Command.withSubcommands')) return [];
  const names: string[] = [];
  for (const subcall of call.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (calleeOf(subcall) !== 'Command.withSubcommands') continue;
    const arr = subcall.getArguments()[0];
    if (arr?.getKind() !== SyntaxKind.ArrayLiteralExpression) continue;
    for (const el of (arr as ArrayLiteralExpression).getElements()) {
      if (el.getKind() === SyntaxKind.Identifier) {
        names.push((el as Identifier).getText());
      }
    }
  }
  return names;
};

export const findCliCommands = (
  sf: SourceFile,
  filePath?: string,
): CliCommandReport => {
  const { SyntaxKind } = loadTsMorph();
  const fp = filePath ?? sf.getFilePath();

  // Collect Prompt.* calls at file scope for attaching to commands.
  const prompts: CliPromptInfo[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = calleeOf(call);
    if (!isPromptCallee(callee)) continue;
    const kind = callee.split('.').pop() ?? callee;
    const first = call.getArguments()[0]?.getText();
    prompts.push({ kind, nameOrLabel: first ? trimText(first) : undefined });
  }

  const commands: CliCommandInfo[] = [];
  const runs: CliRunInfo[] = [];

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = calleeOf(call);
    if (callee === 'Command.make') {
      const args = call.getArguments();
      const first = args[0];
      let name = 'unknown';
      if (first?.getKind() === SyntaxKind.StringLiteral) {
        name = (first as StringLiteral).getLiteralValue();
      } else if (first) {
        name = trimText(first.getText());
      }
      const { args: positional, options } = collectArgsAndOptions(call);
      commands.push({
        name,
        location: makeLocation(call, fp),
        options,
        args: positional,
        prompts,
        hasHandler: hasWithHandler(call, sf),
        subcommandNames: subcommandNamesFromCall(call),
      });
    } else if (callee === 'Command.run') {
      const args = call.getArguments();
      const rootArg = args[0]?.getText();
      let runName: string | undefined;
      let version: string | undefined;
      const second = args[1];
      if (second?.getKind() === SyntaxKind.ObjectLiteralExpression) {
        for (const p of (second as ObjectLiteralExpression).getProperties()) {
          if (p.getKind() !== SyntaxKind.PropertyAssignment) continue;
          const pa = p as PropertyAssignment;
          const nm = pa.getName();
          const init = pa.getInitializer();
          if (!init) continue;
          if (nm === 'name' && init.getKind() === SyntaxKind.StringLiteral) {
            runName = (init as StringLiteral).getLiteralValue();
          } else if (
            nm === 'version' &&
            init.getKind() === SyntaxKind.StringLiteral
          ) {
            version = (init as StringLiteral).getLiteralValue();
          }
        }
      }
      runs.push({
        rootCommand: rootArg,
        name: runName,
        version,
        location: makeLocation(call, fp),
      });
    }
  }

  return { filePath: fp, commands, runs };
};

export const analyzeCliCommandsFile = (
  filePath: string,
): Effect.Effect<CliCommandReport, AnalysisError> =>
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
    return findCliCommands(sf, filePath);
  });

export const analyzeCliCommandsSource = (
  code: string,
  filePath = 'temp.ts',
): CliCommandReport => {
  const sf = createProjectFromSource(code, filePath);
  return findCliCommands(sf, filePath);
};
