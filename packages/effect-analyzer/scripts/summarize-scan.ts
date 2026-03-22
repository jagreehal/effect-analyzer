import { readFileSync } from 'fs';
import { basename } from 'path';
import type { ScanReport } from './effect-scan-utils';

function main(): void {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('usage: pnpm exec tsx scripts/summarize-scan.ts <scan.json> [--limit N]');
    process.exit(1);
  }

  const limitArgIndex = process.argv.indexOf('--limit');
  const limit =
    limitArgIndex >= 0 && process.argv[limitArgIndex + 1]
      ? Number.parseInt(process.argv[limitArgIndex + 1]!, 10)
      : 15;

  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as ScanReport;

  console.log(
    `${basename(reportPath)} total=${report.summary.total} ok=${report.summary.ok} fail=${report.summary.fail} throw=${report.summary.throwCount}`,
  );

  const reasonCounts = new Map<string, number>();
  for (const row of report.rows) {
    if (!row.zeroProgramsReason) continue;
    reasonCounts.set(row.zeroProgramsReason, (reasonCounts.get(row.zeroProgramsReason) ?? 0) + 1);
  }

  if (reasonCounts.size > 0) {
    console.log('zeroProgramsReason counts:');
    for (const [reason, count] of Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`- ${reason}: ${count}`);
    }
  }

  const nonOk = report.rows.filter((row) => !row.tag.startsWith('OK:'));
  if (nonOk.length > 0) {
    console.log(`non-OK rows (sample ${Math.min(limit, nonOk.length)}):`);
    for (const row of nonOk.slice(0, Math.max(1, limit))) {
      const reason = row.zeroProgramsReason ? ` (${row.zeroProgramsReason})` : '';
      console.log(`- ${basename(row.file)} ${row.tag}${reason}`);
    }
  }
}

main();
