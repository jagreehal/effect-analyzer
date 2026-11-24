/**
 * The Effect language service findings a change introduced: on a line it touched,
 * and more of them than base had. Types come from the ref under review; only the
 * working tree is checked where it is.
 */

import { resolve } from "node:path"
import { countFindings, takeFromBaseline } from "./finding-baseline"
import type { ReviewFinding, ReviewOptions } from "./pr-review"
import { checkAtRef, type RefCheck } from "./review-snapshot"
import { checkFilesWithTsgo, importsEffect, type TsgoDiagnostic } from "./tsgo-diagnostics"

/** A file of the change, as it is at head. */
export interface TypedFile {
  readonly path: string
  /** Where it is at base, unless the change added it. */
  readonly basePath: string | undefined
  readonly source: string
  /** Reads the lines the change touched, which only a file with findings needs. */
  readonly changedLines: () => (line: number) => boolean
}

interface HeadCheck {
  readonly checked: ReadonlyArray<readonly [TypedFile, ReadonlyArray<TsgoDiagnostic>]>
  readonly skipped: ReadonlyArray<string>
}

const checkWorkingTree = (files: ReadonlyArray<TypedFile>, cwd: string): HeadCheck => {
  const check = checkFilesWithTsgo(files.map((f) => resolve(cwd, f.path)))
  const excluded = files.filter((f) => !check.checked.has(resolve(cwd, f.path)) && importsEffect(f.source))
  return {
    checked: files.map((f) => [f, check.diagnostics.filter((d) => d.filePath === resolve(cwd, f.path))] as const),
    skipped: [...check.skipped, ...excluded.map((f) => `${f.path}: not checked under its tsconfig`)]
  }
}

const skippedAtHead = (head: string, file: TypedFile, check: RefCheck): string | undefined => {
  switch (check.kind) {
    case "checked":
      return undefined
    case "incomplete":
      return `${file.path}: ${head} was checked without files that are not in git (${check.reason})`
    case "excluded":
      return importsEffect(file.source)
        ? `${file.path}: ${head} could not be checked (not checked under its tsconfig)`
        : undefined
    case "unavailable":
      return `${file.path}: ${head} could not be checked (${check.reason})`
  }
}

/** From git alone: what else is in the checkout cannot change the findings. */
const checkHeadRef = (head: string, files: ReadonlyArray<TypedFile>, cwd: string): HeadCheck => {
  const checks = checkAtRef(head, files.map((f) => [f, f.path] as const), cwd)
  return {
    checked: checks.flatMap(([file, check]) => "diagnostics" in check ? [[file, check.diagnostics] as const] : []),
    skipped: checks.map(([file, check]) => skippedAtHead(head, file, check)).filter((s) => s !== undefined)
  }
}

/** Base's findings, or why there are none to compare with. */
const baselineOf = (
  check: RefCheck,
  headIsWorkingTree: boolean
): { readonly findings: ReadonlyArray<TsgoDiagnostic> } | { readonly unavailable: string } => {
  switch (check.kind) {
    case "checked":
      return { findings: check.diagnostics }
    case "incomplete":
      // Two refs both go without what is not in git; the working tree has it, so base must too.
      return headIsWorkingTree ? { unavailable: check.reason } : { findings: check.diagnostics }
    case "excluded":
      return { unavailable: "not checked under its tsconfig" }
    case "unavailable":
      return { unavailable: check.reason }
  }
}

interface Candidate {
  readonly file: TypedFile
  readonly touched: ReadonlyArray<TsgoDiagnostic>
  readonly untouched: ReadonlyArray<TsgoDiagnostic>
}

const candidatesIn = ([file, diagnostics]: readonly [TypedFile, ReadonlyArray<TsgoDiagnostic>]): ReadonlyArray<
  Candidate
> => {
  const reported = diagnostics.filter((d) => d.severity !== "info")
  if (reported.length === 0) return []
  const isTouched = file.changedLines()
  const touched = reported.filter((d) => isTouched(d.line))
  return touched.length === 0 ? [] : [{ file, touched, untouched: reported.filter((d) => !isTouched(d.line)) }]
}

/** Matched by rule and message, so that reformatting keeps a finding's identity. */
const introduced = (
  { file, touched, untouched }: Candidate,
  before: ReadonlyArray<TsgoDiagnostic>
): ReadonlyArray<ReviewFinding> => {
  const baseline = countFindings(before)
  // Findings the change left alone account for their own share of base first.
  for (const d of untouched) takeFromBaseline(baseline, d)
  return touched.filter((d) => !takeFromBaseline(baseline, d)).map((d) => ({
    file: file.path,
    line: d.line,
    rule: d.rule,
    severity: d.severity,
    message: d.message
  }))
}

export const typeAwareFindings = (
  { base, head }: Pick<ReviewOptions, "base" | "head">,
  files: ReadonlyArray<TypedFile>,
  cwd: string
): { readonly findings: ReadonlyArray<ReviewFinding>; readonly skipped: ReadonlyArray<string> } => {
  const { checked, skipped } = head === undefined ? checkWorkingTree(files, cwd) : checkHeadRef(head, files, cwd)
  const candidates = checked.flatMap(candidatesIn)

  // Only now is base worth checking: most changes have nothing to compare.
  const before = new Map(
    checkAtRef(
      base,
      candidates.flatMap((c) => c.file.basePath === undefined ? [] : [[c, c.file.basePath] as const]),
      cwd
    )
      .map(([c, check]) => [c, baselineOf(check, head === undefined)] as const)
  )
  return {
    findings: candidates.flatMap((c) => {
      const baseline = before.get(c)
      return introduced(c, baseline && "findings" in baseline ? baseline.findings : [])
    }),
    skipped: [
      ...skipped,
      ...[...before].flatMap(([{ file }, baseline]) =>
        "unavailable" in baseline
          ? [
            `${file.path}: ${base} could not be checked (${baseline.unavailable}), so findings on changed lines count as new`
          ]
          : []
      )
    ]
  }
}
