/** Discover and analyze a project once so every project view uses the same facts. */

import { Effect } from 'effect';
import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { analyze } from './analyze';
import type { StaticEffectIR } from './types';

export type ProjectCorpusFileStatus = 'ok' | 'zero' | 'fail';

export interface ProjectCorpusFile {
  readonly file: string;
  readonly status: ProjectCorpusFileStatus;
  readonly programs: readonly StaticEffectIR[];
  readonly error?: string | undefined;
  readonly durationMs?: number | undefined;
}

export interface ProjectCorpus {
  readonly root: string;
  readonly files: readonly ProjectCorpusFile[];
  readonly durationMs: number;
}

export interface ScanProjectCorpusOptions {
  readonly tsconfig?: string | undefined;
  readonly extensions?: readonly string[] | undefined;
  readonly maxDepth?: number | undefined;
  readonly includePerFileTiming?: boolean | undefined;
  readonly knownEffectInternalsRoot?: string | undefined;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx'] as const;
const DEFAULT_MAX_DEPTH = 10;

export const discoverProjectFiles = async (
  dir: string,
  extensions: readonly string[] = DEFAULT_EXTENSIONS,
  maxDepth = DEFAULT_MAX_DEPTH,
  currentDepth = 0,
): Promise<readonly string[]> => {
  if (currentDepth >= maxDepth) return [];
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') {
          files.push(...await discoverProjectFiles(
            fullPath,
            extensions,
            maxDepth,
            currentDepth + 1,
          ));
        }
      } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
        files.push(fullPath);
      }
    }
  } catch {
    // An unreadable directory contributes no files. Individual analysis failures
    // remain visible in the corpus once a file has been discovered.
  }
  return files.sort((left, right) => left.localeCompare(right));
};

export const scanProjectCorpus = (
  root: string,
  options: ScanProjectCorpusOptions = {},
): Effect.Effect<ProjectCorpus> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const files = yield* Effect.promise(() => discoverProjectFiles(
      root,
      options.extensions ?? DEFAULT_EXTENSIONS,
      options.maxDepth ?? DEFAULT_MAX_DEPTH,
    ));
    const corpusFiles: ProjectCorpusFile[] = [];

    // Analysis remains sequential until node IDs and ts-morph projects are owned
    // by the Analysis session instead of shared module globals.
    for (const file of files) {
      const fileStartedAt = options.includePerFileTiming === true ? Date.now() : 0;
      const result = yield* analyze(file, {
        tsConfigPath: options.tsconfig,
        knownEffectInternalsRoot: options.knownEffectInternalsRoot,
      }).all().pipe(
        Effect.map((programs) => ({ _tag: 'ok' as const, programs })),
        Effect.catch((error) => Effect.succeed({
          _tag: 'fail' as const,
          error: error instanceof Error ? error.message : String(error),
        })),
      );
      const durationMs = options.includePerFileTiming === true
        ? Date.now() - fileStartedAt
        : undefined;

      if (result._tag === 'ok') {
        corpusFiles.push({
          file,
          status: result.programs.length > 0 ? 'ok' : 'zero',
          programs: result.programs,
          ...(durationMs === undefined ? {} : { durationMs }),
        });
        continue;
      }

      const isZero = result.error.includes('No Effect programs found') ||
        result.error.includes('NO_EFFECTS_FOUND');
      corpusFiles.push({
        file,
        status: isZero ? 'zero' : 'fail',
        programs: [],
        ...(isZero ? {} : { error: result.error }),
        ...(durationMs === undefined ? {} : { durationMs }),
      });
    }

    return {
      root,
      files: corpusFiles,
      durationMs: Date.now() - startedAt,
    };
  });
