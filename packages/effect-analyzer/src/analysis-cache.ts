/**
 * Disk cache for analysis results.
 * When --cache is used, IR is stored by file path + content hash for reuse.
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { stat } from 'fs/promises';
import { join } from 'path';
import type { StaticEffectIR } from './types';

const CACHE_DIR = '.effect-analyzer-cache';
const CACHE_VERSION = 1;

interface CacheEntry {
  readonly version: number;
  readonly contentHash: string;
  readonly mtimeMs: number;
  readonly irs: readonly StaticEffectIR[];
}

function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

function cachePath(baseDir: string, filePath: string): string {
  const safe = filePath.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(baseDir, CACHE_DIR, `${safe}.json`);
}

/**
 * Read cached IRs if valid (same content hash and mtime).
 */
export async function getCached(
  filePath: string,
  content: string,
  baseDir: string = process.cwd(),
): Promise<readonly StaticEffectIR[] | null> {
  try {
    const path = cachePath(baseDir, filePath);
    const hash = contentHash(content);
    const raw = await readFile(path, 'utf-8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.version === CACHE_VERSION && entry.contentHash === hash) {
      return entry.irs;
    }
  } catch {
    // Cache miss or invalid
  }
  return null;
}

/**
 * Write IRs to cache.
 */
export async function setCached(
  filePath: string,
  content: string,
  irs: readonly StaticEffectIR[],
  baseDir: string = process.cwd(),
): Promise<void> {
  try {
    const dir = join(baseDir, CACHE_DIR);
    await mkdir(dir, { recursive: true });
    const s = await stat(filePath).catch(() => null);
    const entry: CacheEntry = {
      version: CACHE_VERSION,
      contentHash: contentHash(content),
      mtimeMs: s?.mtimeMs ?? 0,
      irs,
    };
    await writeFile(cachePath(baseDir, filePath), JSON.stringify(entry), 'utf-8');
  } catch {
    // Ignore cache write failures
  }
}
