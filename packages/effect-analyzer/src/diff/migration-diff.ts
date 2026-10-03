/**
 * Diff a non-Effect "before" file against an Effect "after" file: the
 * migration opportunities found in before vs the programs (and their E / R)
 * in after.
 */

import type { MigrationOpportunity } from "../migration-assistant"
import type { StaticEffectIR } from "../types"

export interface MigrationDiffProgram {
  readonly name: string
  readonly errorType: string
  readonly requirementsType: string
}

export interface MigrationDiff {
  readonly before: string
  readonly after: string
  readonly opportunities: ReadonlyArray<MigrationOpportunity>
  readonly patternCount: number
  readonly programs: ReadonlyArray<MigrationDiffProgram>
  /** Union of the after programs' error types (`never` excluded). */
  readonly errorTypes: ReadonlyArray<string>
  /** Union of the after programs' requirements (`never` excluded). */
  readonly requirements: ReadonlyArray<string>
}

const unionMembers = (types: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(
    types.flatMap((t) => t.split("|").map((m) => m.trim())).filter((m) => m !== "" && m !== "never")
  )
]

export function summarizeMigrationDiff(
  before: string,
  after: string,
  opportunities: ReadonlyArray<MigrationOpportunity>,
  afterIRs: ReadonlyArray<StaticEffectIR>
): MigrationDiff {
  const programs = afterIRs.map((ir) => ({
    name: ir.root.programName,
    errorType: ir.root.typeSignature?.errorType ?? (ir.root.errorTypes.join(" | ") || "never"),
    requirementsType: ir.root.typeSignature?.requirementsType ??
      (ir.root.requiredServices?.map((s) => s.serviceType).join(" | ") || "never")
  }))
  return {
    before,
    after,
    opportunities,
    patternCount: opportunities.filter((o) => o.kind === "pattern").length,
    programs,
    errorTypes: unionMembers(programs.map((p) => p.errorType)),
    requirements: unionMembers(programs.map((p) => p.requirementsType))
  }
}

const orNever = (xs: ReadonlyArray<string>) => (xs.length > 0 ? xs.join(" | ") : "never")
/** Table cell: a union's `|` would otherwise split the column. */
const cell = (type: string) => `\`${type.replaceAll("|", "\\|")}\``

export function renderMigrationDiffMarkdown(diff: MigrationDiff): string {
  const lines = [
    `## Migration: \`${diff.before}\` -> \`${diff.after}\``,
    "",
    `\`${diff.before}\` has no Effect programs, so this compares its migration opportunities with the Effect programs in \`${diff.after}\`.`,
    "",
    `**${String(diff.opportunities.length)} opportunities (${String(diff.patternCount)} patterns) -> ${
      String(diff.programs.length)
    } programs; E = ${orNever(diff.errorTypes)}; R = ${orNever(diff.requirements)}**`,
    "",
    `### Opportunities in \`${diff.before}\``,
    "",
    ...diff.opportunities.map((o) =>
      `- L${String(o.line)} ${o.kind === "pattern" ? "**" + o.pattern + "**" : o.pattern} -> ${
        o.effectApi?.join(" + ") ?? o.suggestion
      }`
    ),
    "",
    `### Programs in \`${diff.after}\``,
    "",
    "| Program | E | R |",
    "| --- | --- | --- |",
    ...diff.programs.map((p) => `| \`${p.name}\` | ${cell(p.errorType)} | ${cell(p.requirementsType)} |`)
  ]
  return lines.join("\n")
}

export function renderMigrationDiffJSON(diff: MigrationDiff, options?: { pretty?: boolean }): string {
  return JSON.stringify({ kind: "migration", ...diff }, null, options?.pretty ? 2 : 0)
}
