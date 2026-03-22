import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { Effect } from 'effect';
import { analyze } from '../src/analyze';

export interface ScanRow {
  readonly file: string;
  readonly tag: string;
  readonly info?: string;
  readonly contains_effect_imports?: boolean;
  readonly contains_effect_calls?: boolean;
  readonly contains_top_level_program_candidate?: boolean;
  readonly zeroProgramsReason?: ZeroProgramsReason;
}

export interface ScanSummary {
  readonly total: number;
  readonly ok: number;
  readonly fail: number;
  readonly throwCount: number;
}

export type ZeroProgramsReason =
  | 'reexport_only_module'
  | 'type_only_or_utility_module'
  | 'state_adt_module'
  | 'helper_functions_without_effect_program_roots'
  | 'effect_family_type_references_only'
  | 'unsupported_pattern'
  | 'unknown';

export interface ScanReport {
  readonly effectRepoPath: string;
  readonly summary: ScanSummary;
  readonly rows: readonly ScanRow[];
  readonly srcRoot?: string;
  readonly internalsRoot?: string;
  readonly filteredByEffectFamilyCalls?: boolean;
}

export const DEFAULT_EFFECT_REPO_PATH = '/Users/jagreehal/dev/js/awaitly/__temp/effect';

export function getEffectRepoPath(): string {
  return resolve(process.env.EFFECT_REPO_PATH ?? DEFAULT_EFFECT_REPO_PATH);
}

export function getEffectSrcRoot(effectRepoPath: string): string {
  return join(effectRepoPath, 'packages', 'effect', 'src');
}

export function getEffectInternalsRoot(effectRepoPath: string): string {
  return join(getEffectSrcRoot(effectRepoPath), 'internal');
}

export function listTopLevelTsFiles(dir: string): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name))
    .sort();
}

export function listTsFilesRecursive(dir: string): readonly string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        visit(full);
      } else if (entry.endsWith('.ts')) {
        out.push(full);
      }
    }
  };
  visit(dir);
  out.sort();
  return out;
}

export function containsEffectFamilyCalls(source: string): boolean {
  return /\b(Effect|STM|Layer|Schedule|Stream|Channel|Sink|Cause|Exit|Fiber|Runtime)\./.test(source);
}

export function containsEffectFamilyImports(source: string): boolean {
  return (
    /\bfrom\s+["'](?:effect(?:["'/])|@effect\/)/.test(source) ||
    /\bfrom\s+["'][^"']*(?:^|\/)(?:Effect|STM|Layer|Schedule|Stream|Channel|Sink|Cause|Exit|Fiber|Runtime)(?:\.[jt]sx?)?["']/.test(source)
  );
}

export function containsEffectFamilyInvocations(source: string): boolean {
  return /\b(Effect|STM|Layer|Schedule|Stream|Channel|Sink|Cause|Exit|Fiber|Runtime)\.[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(source);
}

export function containsProgramRootFamilyInvocations(source: string): boolean {
  return /\b(Effect|STM|Layer|Schedule|Stream|Channel|Sink)\.[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(source);
}

function classifyZeroProgramsReason(source: string): ZeroProgramsReason {
  const hasReexportFrom =
    /export\s+\*\s+from\s+["'][^"']+["']/.test(source) ||
    /export\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["']/.test(source);
  const hasReexportOnly =
    hasReexportFrom &&
    !/export\s+const\s+/.test(source) &&
    !/export\s+function\s+/.test(source) &&
    !/export\s+class\s+/.test(source) &&
    !/export\s+(interface|type)\s+/.test(source);
  if (hasReexportOnly) return 'reexport_only_module';

  const hasExportConst = /export\s+const\s+/.test(source);
  const hasExportFn = /export\s+function\s+/.test(source);
  const hasExportClass = /export\s+class\s+/.test(source);
  const hasExportTypeLike = /export\s+(interface|type)\s+/.test(source);
  const hasEffectCalls = containsEffectFamilyCalls(source);
  const hasEffectInvocations = containsEffectFamilyInvocations(source);
  const hasProgramRootInvocations = containsProgramRootFamilyInvocations(source);
  const hasClassOrInterface = /\b(class|interface)\s+[A-Za-z_]/.test(source);
  const hasPrototypeOrMethods =
    /\b(readonly\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*.*=>)|\b[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{/.test(source);

  if (!hasEffectCalls) {
    if (hasExportTypeLike || /import\s+type\s+/.test(source)) {
      return 'type_only_or_utility_module';
    }
    if (hasExportConst || hasExportFn || hasExportClass) {
      return 'helper_functions_without_effect_program_roots';
    }
    return 'unknown';
  }

  if (!hasEffectInvocations) {
    if (hasClassOrInterface || hasExportTypeLike) {
      return 'state_adt_module';
    }
    return 'effect_family_type_references_only';
  }

  if (!hasProgramRootInvocations) {
    if (hasClassOrInterface || hasExportTypeLike) {
      return 'state_adt_module';
    }
    return 'helper_functions_without_effect_program_roots';
  }

  if (hasExportTypeLike && !hasExportConst && !hasExportFn && !hasExportClass) {
    return 'state_adt_module';
  }

  if (hasClassOrInterface || hasPrototypeOrMethods) {
    return 'unsupported_pattern';
  }

  if (hasExportConst || hasExportFn || hasExportClass) {
    return 'unsupported_pattern';
  }

  return 'unknown';
}

export async function analyzeFileToRow(
  filePath: string,
  knownEffectInternalsRoot: string,
  maxNames = 8,
): Promise<ScanRow> {
  const source = readFileUtf8(filePath);
  const fileSignals = {
    contains_effect_imports: containsEffectFamilyImports(source),
    contains_effect_calls: containsEffectFamilyInvocations(source),
    contains_top_level_program_candidate: containsProgramRootFamilyInvocations(source),
  } as const;

  try {
    const res = await Effect.runPromiseExit(
      analyze(filePath, { knownEffectInternalsRoot }).all(),
    );

    if (res._tag === 'Failure') {
      const cause = res.cause as unknown as {
        _tag?: string;
        error?: { code?: string };
        failure?: { code?: string };
      };
      const code =
        cause?._tag === 'Fail'
          ? (cause.error?.code ?? cause.failure?.code ?? 'unknown')
          : (cause?._tag ?? 'unknown');
      const tag = `FAIL:${String(code)}`;
      if (tag === 'FAIL:NO_EFFECTS_FOUND') {
        return {
          file: filePath,
          tag,
          ...fileSignals,
          zeroProgramsReason: classifyZeroProgramsReason(source),
        };
      }
      return { file: filePath, tag, ...fileSignals };
    }

    const names = res.value.map((ir) => ir.root.programName);
    return {
      file: filePath,
      tag: `OK:${res.value.length}`,
      info: names.slice(0, maxNames).join(','),
      ...fileSignals,
    };
  } catch (error) {
    return {
      file: filePath,
      tag: 'THROW',
      info: String(error),
      ...fileSignals,
    };
  }
}

export function summarizeRows(rows: readonly ScanRow[]): ScanSummary {
  let ok = 0;
  let fail = 0;
  let throwCount = 0;
  for (const row of rows) {
    if (row.tag.startsWith('OK:')) ok++;
    else if (row.tag.startsWith('FAIL:')) fail++;
    else if (row.tag === 'THROW') throwCount++;
  }
  return {
    total: rows.length,
    ok,
    fail,
    throwCount,
  };
}

export function printHumanSummary(label: string, rows: readonly ScanRow[]): void {
  const summary = summarizeRows(rows);
  console.log(`${label}: total=${summary.total} ok=${summary.ok} fail=${summary.fail} throw=${summary.throwCount}`);
  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.zeroProgramsReason) continue;
    reasonCounts.set(row.zeroProgramsReason, (reasonCounts.get(row.zeroProgramsReason) ?? 0) + 1);
  }
  if (reasonCounts.size > 0) {
    const ordered = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);
    console.log(`${label} zeroProgramsReason counts:`);
    for (const [reason, count] of ordered) {
      console.log(`- ${reason}: ${count}`);
    }
  }
  const examples = rows.filter((r) => !r.tag.startsWith('OK:')).slice(0, 15);
  if (examples.length > 0) {
    console.log(`${label} failures (sample):`);
    for (const row of examples) {
      const reason = row.zeroProgramsReason ? ` (${row.zeroProgramsReason})` : '';
      console.log(`- ${basename(row.file)} ${row.tag}${reason}`);
    }
  }
}

export function readFileUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

export function writeJsonFile(path: string, value: unknown): void {
  const resolved = resolve(path);
  mkdirSync(resolve(resolved, '..'), { recursive: true });
  writeFileSync(resolved, JSON.stringify(value, null, 2));
}

export function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}
