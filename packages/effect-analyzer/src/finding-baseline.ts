/** Tells findings a change introduced from ones its base already had. */

import type { LintIssue } from "./effect-linter"

interface Comparable {
  readonly rule: string
  readonly message: string
  readonly severity: LintIssue["severity"]
}

const SEVERITIES: ReadonlyArray<LintIssue["severity"]> = ["info", "warning", "error"]

const findingKey = (f: Comparable, severity: LintIssue["severity"]): string => `${severity}|${f.rule}|${f.message}`

export const countFindings = (findings: ReadonlyArray<Comparable>): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const f of findings) {
    const key = findingKey(f, f.severity)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Pair a head finding with an unpaired base one. A base finding accounts for one
 * as severe or less.
 */
export const takeFromBaseline = (baseline: Map<string, number>, f: Comparable): boolean => {
  for (const severity of SEVERITIES.slice(SEVERITIES.indexOf(f.severity))) {
    const key = findingKey(f, severity)
    const left = baseline.get(key) ?? 0
    if (left > 0) {
      baseline.set(key, left - 1)
      return true
    }
  }
  return false
}
