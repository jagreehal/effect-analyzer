import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { execFileSync } from 'child_process';

const DEFAULT_REPO_URL = 'https://github.com/Effect-TS/effect.git';
const DEFAULT_DEST = resolve('.cache/effect-repo');
const DEFAULT_REF = 'main';

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function runGit(args: readonly string[]): void {
  execFileSync('git', [...args], { stdio: 'inherit' });
}

function main(): void {
  const repoUrl = getArgValue('--repo-url') ?? process.env.EFFECT_REPO_URL ?? DEFAULT_REPO_URL;
  const dest = resolve(getArgValue('--dir') ?? process.env.EFFECT_REPO_PATH ?? DEFAULT_DEST);
  const ref = getArgValue('--ref') ?? process.env.EFFECT_REPO_REF ?? DEFAULT_REF;
  const force = hasFlag('--force');

  if (force && existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  mkdirSync(dirname(dest), { recursive: true });

  if (!existsSync(dest)) {
    runGit(['clone', '--depth', '1', '--branch', ref, repoUrl, dest]);
  } else if (existsSync(resolve(dest, '.git'))) {
    runGit(['-C', dest, 'fetch', '--depth', '1', 'origin', ref]);
    runGit(['-C', dest, 'checkout', '--force', 'FETCH_HEAD']);
  } else {
    throw new Error(`Destination exists and is not a git repo: ${dest}`);
  }

  // Print export hints so callers can reuse the fetched clone.
  console.log(`EFFECT_REPO_PATH=${dest}`);
  console.log(`EFFECT_AUDIT_DIR=${resolve(dest, 'packages')}`);
  console.log(`KNOWN_EFFECT_INTERNALS_ROOT=${resolve(dest, 'packages/effect/src/internal')}`);
}

main();
