import {
  analyzeFileToRow,
  getArgValue,
  getEffectInternalsRoot,
  getEffectRepoPath,
  getEffectSrcRoot,
  listTopLevelTsFiles,
  printHumanSummary,
  summarizeRows,
  writeJsonFile,
} from './effect-scan-utils';

async function main(): Promise<void> {
  const effectRepoPath = getEffectRepoPath();
  const srcRoot = getEffectSrcRoot(effectRepoPath);
  const internalsRoot = getEffectInternalsRoot(effectRepoPath);
  const files = listTopLevelTsFiles(srcRoot);

  const rows = [];
  for (const file of files) {
    rows.push(await analyzeFileToRow(file, internalsRoot, 8));
  }

  const report = {
    effectRepoPath,
    srcRoot,
    internalsRoot,
    summary: summarizeRows(rows),
    rows,
  } as const;

  if (process.argv.includes('--human')) {
    printHumanSummary('effect-top-level', rows);
  }

  const jsonOut = getArgValue('--json-out');
  if (jsonOut) {
    writeJsonFile(jsonOut, report);
    if (process.argv.includes('--human')) {
      console.log(`wrote ${jsonOut}`);
      return;
    }
  }

  if (process.argv.includes('--human')) {
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

void main();
