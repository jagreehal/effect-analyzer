import { readFileSync } from 'fs';
import { basename } from 'path';
import type { ScanReport, ScanRow } from './effect-scan-utils';

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

function getArgInt(flag: string, fallback: number): number {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadReport(path: string): ScanReport {
  return JSON.parse(readFileSync(path, 'utf8')) as ScanReport;
}

function matchesTag(row: ScanRow, tagFilter?: string): boolean {
  if (!tagFilter) return true;
  return row.tag === tagFilter || row.tag.startsWith(tagFilter);
}

function matchesReason(row: ScanRow, reasonFilter?: string): boolean {
  if (!reasonFilter) return true;
  return row.zeroProgramsReason === reasonFilter;
}

function sourcePreview(file: string, maxLines: number): string {
  try {
    const src = readFileSync(file, 'utf8');
    return src.split('\n').slice(0, maxLines).join('\n');
  } catch (error) {
    return `<failed to read: ${String(error)}>`;
  }
}

function main(): void {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error(
      'usage: pnpm exec tsx scripts/triage-effect-scan.ts <scan.json> [--reason <zeroProgramsReason>] [--tag <prefix>] [--limit N] [--preview-lines N]',
    );
    process.exit(1);
  }

  const report = loadReport(reportPath);
  const reason = getArgValue('--reason');
  const tag = getArgValue('--tag');
  const limit = getArgInt('--limit', 20);
  const previewLines = getArgInt('--preview-lines', 0);

  const rows = report.rows
    .filter((row) => matchesTag(row, tag))
    .filter((row) => matchesReason(row, reason));

  console.log(`report=${basename(reportPath)} total=${report.rows.length} matched=${rows.length}`);
  if (reason) console.log(`reason=${reason}`);
  if (tag) console.log(`tag=${tag}`);

  for (const row of rows.slice(0, limit)) {
    const reasonText = row.zeroProgramsReason ? ` (${row.zeroProgramsReason})` : '';
    console.log(`\n- ${row.file}`);
    console.log(`  ${row.tag}${reasonText}${row.info ? ` :: ${row.info}` : ''}`);
    if (previewLines > 0) {
      const preview = sourcePreview(row.file, previewLines)
        .split('\n')
        .map((line) => `  | ${line}`)
        .join('\n');
      console.log(preview);
    }
  }

  if (rows.length > limit) {
    console.log(`\n... ${rows.length - limit} more rows (increase --limit)`);
  }
}

main();

