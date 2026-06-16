/**
 * Migration progress: snapshot two migration scans and diff them to see what
 * got fixed, what's new, and what remains.
 *
 */

import {
  findMigrationOpportunities,
  type MigrationOpportunity,
} from './migration-assistant';

// =============================================================================
// Types
// =============================================================================

export interface MigrationSnapshot {
  /** ISO timestamp, supplied by the caller so this module stays pure/testable. */
  readonly takenAt: string;
  readonly opportunities: readonly MigrationOpportunity[];
}

export interface MigrationDelta {
  /** Present in `prev`, gone in `curr` — i.e. migrated away. */
  readonly fixed: readonly MigrationOpportunity[];
  /** New in `curr`, absent from `prev` — regressions or newly-touched code. */
  readonly added: readonly MigrationOpportunity[];
  /** Present in both snapshots — still to do. */
  readonly remaining: readonly MigrationOpportunity[];
  readonly fixedCount: number;
  readonly addedCount: number;
  readonly remainingCount: number;
  /** `fixed / (fixed + remaining)` for the patterns seen in `prev`, 0..1. */
  readonly progress: number;
}

// =============================================================================
// Stable keys
// =============================================================================

function normalizeSnippet(snippet: string | undefined): string {
  return (snippet ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Stable, line-independent identity for an opportunity. Two scans of the same
 * code produce the same key even if line numbers moved.
 *
 * The `occurrence` index disambiguates genuinely-identical opportunities in the
 * same file (e.g. two `throw error;` statements), so they don't collapse to one
 * key. It is assigned deterministically by source order within each file.
 */
export function deriveOpportunityKey(
  opp: MigrationOpportunity,
  occurrence: number,
): string {
  return `${opp.filePath}::${opp.pattern}::${normalizeSnippet(opp.codeSnippet)}::${occurrence}`;
}

/** Build a key→opportunity map, assigning occurrence indices per identical tuple. */
function keyOpportunities(
  opportunities: readonly MigrationOpportunity[],
): Map<string, MigrationOpportunity> {
  const seen = new Map<string, number>();
  const out = new Map<string, MigrationOpportunity>();
  for (const opp of opportunities) {
    const base = `${opp.filePath}::${opp.pattern}::${normalizeSnippet(opp.codeSnippet)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    out.set(deriveOpportunityKey(opp, occurrence), opp);
  }
  return out;
}

// =============================================================================
// Snapshot + diff
// =============================================================================

/** Take a snapshot of a single file's migration opportunities. */
export function snapshotFile(
  filePath: string,
  takenAt: string,
  source?: string,
): MigrationSnapshot {
  return {
    takenAt,
    opportunities: findMigrationOpportunities(filePath, source),
  };
}

/**
 * Diff two snapshots by stable content key.
 *
 * `progress` is computed against the work that existed in `prev` (fixed vs.
 * fixed+remaining), so newly-added opportunities don't perversely lower it.
 * If `prev` was clean but `curr` introduced new work, report 0 progress rather
 * than 100% so regressions are unambiguously visible in CI/dashboards.
 */
export function diffMigrationSnapshots(
  prev: MigrationSnapshot,
  curr: MigrationSnapshot,
): MigrationDelta {
  const prevKeys = keyOpportunities(prev.opportunities);
  const currKeys = keyOpportunities(curr.opportunities);

  const fixed: MigrationOpportunity[] = [];
  const remaining: MigrationOpportunity[] = [];
  for (const [key, opp] of prevKeys) {
    if (currKeys.has(key)) {
      remaining.push(opp);
    } else {
      fixed.push(opp);
    }
  }

  const added: MigrationOpportunity[] = [];
  for (const [key, opp] of currKeys) {
    if (!prevKeys.has(key)) {
      added.push(opp);
    }
  }

  const baseline = fixed.length + remaining.length;
  const progress =
    baseline === 0
      ? added.length === 0
        ? 1
        : 0
      : fixed.length / baseline;

  return {
    fixed,
    added,
    remaining,
    fixedCount: fixed.length,
    addedCount: added.length,
    remainingCount: remaining.length,
    progress,
  };
}

/** Render a short, human/agent-readable progress line. */
export function formatMigrationDelta(delta: MigrationDelta): string {
  const pct = Math.round(delta.progress * 100);
  const parts = [
    `${delta.fixedCount} fixed`,
    `${delta.remainingCount} remaining`,
  ];
  if (delta.addedCount > 0) parts.push(`${delta.addedCount} new`);
  return `Migration progress: ${pct}% (${parts.join(', ')})`;
}
