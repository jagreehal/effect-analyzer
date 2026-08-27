/**
 * API surface modes: HttpApi docs, OpenAPI paths, and exact JSON Schema.
 *
 * Two of these leave static analysis behind and run the project in a child
 * process, which is why they live together: they share that trust boundary.
 */

/**
 * CLI entry point for effect-analyzer
 */

import './register-node-ts-morph';
import { resolve, join, dirname, extname } from 'path';
import { existsSync } from 'fs';
import * as fs from 'node:fs/promises';
import { Project } from 'ts-morph';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { Effect, Console, Option } from 'effect';
import {
  cliFail,
  cliTry,
} from './cli-support';
import {
  type CLIOptions,
} from './cli-options';
import { probeJsonSchema, SECURITY_NOTE } from './runtime-probe';
import { renderApiDocsMarkdown, renderOpenApiPaths } from './output/api-docs';
import { extractHttpApiStructure, type HttpApiStructure } from './http-api-extractor';

/** Run openapi-runtime: spawn runner script to call OpenApi.fromApi on user's HttpApi. */
export const runOpenApiRuntime = (
  entrypointPath: string,
  options: CLIOptions,
) =>
  Effect.callback<undefined, Error>((resume) => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const runnerPath = join(__dirname, '..', 'scripts', 'openapi-runtime-runner.mjs');
    const absEntrypoint = resolve(process.cwd(), entrypointPath);
    const entrypointDir = dirname(absEntrypoint);
    // Walk up to find package root (dir with package.json) for module resolution
    const findPackageRoot = (dir: string): string => {
      let d = dir;
      for (let i = 0; i < 20; i++) {
        if (existsSync(join(d, 'package.json'))) return d;
        const parent = dirname(d);
        if (parent === d) break;
        d = parent;
      }
      return entrypointDir;
    };
    const cwd = findPackageRoot(entrypointDir);
    const runnerArgs = [
      absEntrypoint,
      options.openapiExport ?? 'default',
      ...(options.output ? ['--output', resolve(process.cwd(), options.output)] : []),
    ];
    const child = spawn('npx', ['tsx', runnerPath, ...runnerArgs], {
      stdio: options.output ? ['inherit', 'pipe', 'inherit'] : 'inherit',
      shell: false,
      cwd,
    });
    if (options.output) {
      child.stdout?.on('data', (d) => process.stdout.write(d as Uint8Array));
    }
    child.on('close', (code) => {
      if (code === 0) resume(Effect.succeed(undefined));
      else resume(cliFail(`OpenAPI runtime exited with code ${code}`));
    });
    child.on('error', (err: unknown) => { resume(cliFail('OpenAPI runtime failed to start', err)); });
  });

/**
 * Run json-schema format: ask the project for the exact JSON Schema of one
 * exported `Schema`, rather than re-deriving it from the AST.
 */
export const runJsonSchemaMode = (resolvedPath: string, options: CLIOptions) =>
  Effect.gen(function* () {
    const exportName = options.openapiExport;
    if (exportName === undefined) {
      yield* Console.error('json-schema requires --export <name> naming the Schema to convert.');
      return yield* cliFail('json-schema needs --export');
    }
    if (!options.quiet) yield* Console.error(SECURITY_NOTE);

    const document = yield* probeJsonSchema(resolvedPath, exportName, {
      cwd: dirname(resolve(process.cwd(), resolvedPath)),
    }).pipe(Effect.tapError((error) => Console.error(`Error: ${error.reason}`)));

    const rendered = JSON.stringify(document, null, options.pretty ? 2 : undefined);
    const outputPath = options.output;
    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, rendered, 'utf-8'));
      yield* Console.log(`Output written to ${outputPath}`);
    } else {
      yield* Console.log(rendered);
    }
    return undefined;
  });

/** Run api-docs or openapi-paths format (HttpApi extractor, not Effect analyzer). */
export const runApiDocsMode = (
  resolvedPath: string,
  options: CLIOptions,
) =>
  Effect.gen(function* () {
    const project = options.tsconfig
      ? new Project({ tsConfigFilePath: options.tsconfig })
      : new Project({ skipAddingFilesFromTsConfig: true });

    let files: string[];
    const stat = yield* cliTry(() => fs.stat(resolvedPath)).pipe(
      Effect.option,
    );
    if (Option.isSome(stat) && stat.value.isDirectory()) {
      const exts = ['.ts', '.tsx'];
      const walk = async (dir: string, depth: number): Promise<string[]> => {
        if (depth > 10) return [];
        const result: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') {
            result.push(...(await walk(full, depth + 1)));
          } else if (e.isFile() && exts.includes(extname(e.name))) {
            result.push(full);
          }
        }
        return result;
      };
      files = yield* cliTry(() => walk(resolvedPath, 0));
    } else {
      files = [resolvedPath];
    }

    const allStructures: HttpApiStructure[] = [];
    for (const file of files) {
      // Unparseable files are skipped, not fatal.
      const structures = yield* Effect.try(() =>
        extractHttpApiStructure(project.addSourceFileAtPath(file), file),
      ).pipe(Effect.orElseSucceed(() => [] as readonly HttpApiStructure[]));
      allStructures.push(...structures);
    }

    const output = options.format === 'openapi-paths'
      ? JSON.stringify(renderOpenApiPaths(allStructures), null, options.pretty ? 2 : undefined)
      : renderApiDocsMarkdown(allStructures);

    const outputPath = options.output;
    if (outputPath) {
      yield* cliTry(() => fs.writeFile(outputPath, output, 'utf-8'));
      yield* Console.log(`Output written to ${outputPath}`);
    } else {
      yield* Console.log(output);
    }
  });
