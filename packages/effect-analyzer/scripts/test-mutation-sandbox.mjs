#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sentinel = join(packageRoot, 'src', 'analysis-retention.ts');
const original = await readFile(sentinel, 'utf8');
let sourceWasRewritten = false;

const child = spawn(
  join(packageRoot, 'node_modules', '.bin', 'stryker'),
  [
    'run',
    '--dryRunOnly',
    '--testFiles',
    'src/analysis-retention.test.ts',
    '--mutate',
    'src/analysis-retention.ts',
    '--reporters',
    'progress',
  ],
  { cwd: packageRoot, stdio: 'inherit' },
);

const poll = setInterval(async () => {
  const current = await readFile(sentinel, 'utf8');
  sourceWasRewritten ||= current !== original;
}, 10);

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
clearInterval(poll);

const restored = await readFile(sentinel, 'utf8');
const setupArtifacts = (await readdir(packageRoot)).filter((name) =>
  /^stryker-setup-\d+\.js$/.test(name),
);

if (exitCode !== 0) throw new Error(`Stryker dry run exited with code ${String(exitCode)}`);
if (sourceWasRewritten) throw new Error('Stryker rewrote tracked source during its run');
if (restored !== original) throw new Error('Stryker did not restore the tracked source');
if (setupArtifacts.length > 0) {
  throw new Error(`Stryker left setup artifacts: ${setupArtifacts.join(', ')}`);
}
