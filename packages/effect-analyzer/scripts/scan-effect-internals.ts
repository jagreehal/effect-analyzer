import {
  analyzeFileToRow,
  containsEffectFamilyCalls,
  getArgValue,
  getEffectInternalsRoot,
  getEffectRepoPath,
  listTsFilesRecursive,
  printHumanSummary,
  readFileUtf8,
  summarizeRows,
  writeJsonFile,
} from './effect-scan-utils';

async function main(): Promise<void> {
  const effectRepoPath = getEffectRepoPath();
  const internalsRoot = getEffectInternalsRoot(effectRepoPath);
  const allFiles = listTsFilesRecursive(internalsRoot);
  const files = allFiles.filter((file) => containsEffectFamilyCalls(readFileUtf8(file)));

  const rows = [];
  for (const file of files) {
    rows.push(await analyzeFileToRow(file, internalsRoot, 4));
  }

  const report = {
    effectRepoPath,
    internalsRoot,
    filteredByEffectFamilyCalls: true,
    summary: summarizeRows(rows),
    rows,
  } as const;

  if (process.argv.includes('--human')) {
    printHumanSummary('effect-internals', rows);
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
