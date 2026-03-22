import { Effect } from 'effect';
import { join, resolve } from 'path';
import { analyze } from '../src/analyze';

const DEFAULT_EFFECT_REPO_PATH = '/Users/jagreehal/dev/js/awaitly/__temp/effect';

function getEffectRepoPath(): string {
  return resolve(process.env.EFFECT_REPO_PATH ?? DEFAULT_EFFECT_REPO_PATH);
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

function getModules(): string[] {
  const raw = getArgValue('--modules');
  if (!raw) return ['Effect.ts', 'Layer.ts', 'Schedule.ts', 'Stream.ts', 'Chunk.ts'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function auditModule(
  filePath: string,
  knownEffectInternalsRoot: string,
): Promise<unknown> {
  const base = await Effect.runPromise(
    analyze(filePath, { knownEffectInternalsRoot }).all().pipe(Effect.either),
  );
  if (base._tag === 'Left') {
    return { file: filePath, error: base.left.code };
  }

  const rows = base.right;
  const low = rows.filter((r) => r.root.discoveryConfidence === 'low');
  const medium = rows.filter((r) => r.root.discoveryConfidence === 'medium');
  const high = rows.filter((r) => r.root.discoveryConfidence === 'high');

  const publicHigh = await Effect.runPromise(
    analyze(filePath, {
      knownEffectInternalsRoot,
      onlyExportedPrograms: true,
      minDiscoveryConfidence: 'high',
    }).all().pipe(Effect.either),
  );

  const exportedAll = await Effect.runPromise(
    analyze(filePath, {
      knownEffectInternalsRoot,
      onlyExportedPrograms: true,
      minDiscoveryConfidence: 'low',
    }).all().pipe(Effect.either),
  );

  const exportedLowNames =
    exportedAll._tag === 'Left'
      ? []
      : exportedAll.right
          .filter((r) => r.root.discoveryConfidence === 'low')
          .map((r) => r.root.programName);

  return {
    file: filePath,
    total: rows.length,
    confidence: {
      high: high.length,
      medium: medium.length,
      low: low.length,
    },
    lowNames: low.map((r) => r.root.programName),
    exportedLowNames,
    launchReadyPublicSurface: exportedLowNames.length === 0,
    publicHigh:
      publicHigh._tag === 'Left'
        ? { error: publicHigh.left.code }
        : {
            count: publicHigh.right.length,
            sample: publicHigh.right.slice(0, 20).map((r) => r.root.programName),
          },
  };
}

async function main(): Promise<void> {
  const effectRepoPath = getEffectRepoPath();
  const srcRoot = join(effectRepoPath, 'packages', 'effect', 'src');
  const internalsRoot = join(srcRoot, 'internal');
  const modules = getModules();

  const reports = [];
  for (const mod of modules) {
    reports.push(await auditModule(join(srcRoot, mod), internalsRoot));
  }

  console.log(
    JSON.stringify(
      {
        effectRepoPath,
        srcRoot,
        internalsRoot,
        modules,
        reports,
      },
      null,
      2,
    ),
  );
}

void main();
