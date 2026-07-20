/**
 * Effect Version Compatibility (GAP 25)
 *
 * Reads package.json and verifies the Effect v4-only support contract.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

// =============================================================================
// Types
// =============================================================================

export interface EffectVersionInfo {
  readonly version: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly isPrerelease: boolean;
}

export interface VersionCompatReport {
  readonly effectVersion: EffectVersionInfo | null;
  readonly deprecationWarnings: string[];
  readonly suggestion: string | null;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

function parseVersion(version: string): EffectVersionInfo | null {
  const m = VERSION_RE.exec(version);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return {
    version,
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    isPrerelease: !!m[4],
  };
}

/**
 * Read Effect version from package.json at dir (or cwd).
 */
export async function getEffectVersion(
  dir: string = process.cwd(),
): Promise<EffectVersionInfo | null> {
  try {
    const pkgPath = join(dir, 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const effectVersion = deps.effect;
    if (typeof effectVersion !== 'string') return null;
    const clean = effectVersion.replace(/^[\^~]/, '');
    return parseVersion(clean);
  } catch {
    return null;
  }
}

/**
 * Produce a minimal compatibility report (version + any known deprecations).
 */
export async function checkVersionCompat(
  projectRoot: string = process.cwd(),
): Promise<VersionCompatReport> {
  const effectVersion = await getEffectVersion(projectRoot);
  const deprecationWarnings: string[] = [];
  let suggestion: string | null = null;
  if (effectVersion) {
    if (effectVersion.major !== 4) {
      deprecationWarnings.push(
        `Effect v${String(effectVersion.major)} is unsupported; effect-analyzer requires Effect v4`,
      );
      suggestion = 'pnpm add effect@^4.0.0';
    }
  } else {
    suggestion = 'Add "effect" to dependencies to enable version checks';
  }
  return { effectVersion, deprecationWarnings, suggestion };
}
