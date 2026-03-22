import { readFileSync } from 'fs';
import { basename } from 'path';
import type { ScanReport, ScanRow } from './effect-scan-utils';

interface RowDelta {
  readonly file: string;
  readonly before?: string;
  readonly after?: string;
}

function readJson(path: string): ScanReport {
  return JSON.parse(readFileSync(path, 'utf8')) as ScanReport;
}

function rowMap(rows: readonly ScanRow[]): Map<string, ScanRow> {
  return new Map(rows.map((r) => [r.file, r]));
}

function classifyDelta(before?: ScanRow, after?: ScanRow): 'added' | 'removed' | 'changed' | 'same' {
  if (!before && after) return 'added';
  if (before && !after) return 'removed';
  if (!before || !after) return 'same';
  return before.tag === after.tag ? 'same' : 'changed';
}

function main(): void {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error('usage: pnpm exec tsx scripts/diff-effect-scans.ts <before.json> <after.json>');
    process.exit(1);
  }

  const before = readJson(beforePath);
  const after = readJson(afterPath);
  const beforeMap = rowMap(before.rows);
  const afterMap = rowMap(after.rows);
  const files = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort();

  const added: RowDelta[] = [];
  const removed: RowDelta[] = [];
  const changed: RowDelta[] = [];
  let improved = 0;
  let regressed = 0;

  for (const file of files) {
    const b = beforeMap.get(file);
    const a = afterMap.get(file);
    const kind = classifyDelta(b, a);
    if (kind === 'same') continue;
    const delta: RowDelta = { file, before: b?.tag, after: a?.tag };
    if (kind === 'added') added.push(delta);
    else if (kind === 'removed') removed.push(delta);
    else changed.push(delta);

    if (b && a) {
      if (b.tag.startsWith('FAIL:') && a.tag.startsWith('OK:')) improved++;
      if (b.tag.startsWith('OK:') && a.tag.startsWith('FAIL:')) regressed++;
    }
  }

  console.log(`before: ${basename(beforePath)} total=${before.summary.total} ok=${before.summary.ok} fail=${before.summary.fail} throw=${before.summary.throwCount}`);
  console.log(`after:  ${basename(afterPath)} total=${after.summary.total} ok=${after.summary.ok} fail=${after.summary.fail} throw=${after.summary.throwCount}`);
  console.log(`changed=${changed.length} added=${added.length} removed=${removed.length} improved=${improved} regressed=${regressed}`);

  const limit = 40;
  if (changed.length > 0) {
    console.log('changed rows (sample):');
    for (const d of changed.slice(0, limit)) {
      console.log(`- ${basename(d.file)}: ${d.before} -> ${d.after}`);
    }
  }
  if (added.length > 0) {
    console.log('added rows (sample):');
    for (const d of added.slice(0, 20)) {
      console.log(`- ${basename(d.file)}: ${d.after}`);
    }
  }
  if (removed.length > 0) {
    console.log('removed rows (sample):');
    for (const d of removed.slice(0, 20)) {
      console.log(`- ${basename(d.file)}: ${d.before}`);
    }
  }
}

main();

