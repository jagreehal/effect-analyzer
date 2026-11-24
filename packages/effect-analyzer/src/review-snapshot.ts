/**
 * Effect language service findings at a git ref.
 *
 * Types need a project on disk, so the ref's source is written to a temporary
 * directory and checked there. A ref that cannot be reconstructed is `unavailable`,
 * with the reason.
 */

import { execFileSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { dirsUpTo, isInside } from "./paths"
import { type Flaw, isRepoSource, makeInputAudit, type Snapshot } from "./review-input-audit"
import { nearestTsconfig } from "./tsconfigs"
import { checkFilesWithTsgo, type TsgoDiagnostic } from "./tsgo-diagnostics"

export type RefCheck =
  | { readonly kind: "checked"; readonly diagnostics: ReadonlyArray<TsgoDiagnostic> }
  /** Checked without something that the checkout has and git does not. */
  | { readonly kind: "incomplete"; readonly diagnostics: ReadonlyArray<TsgoDiagnostic>; readonly reason: string }
  /** Not part of a project the language service could check. */
  | { readonly kind: "excluded" }
  | { readonly kind: "unavailable"; readonly reason: string }

const isLink = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false

const SNAPSHOT_PREFIX = "effect-analyzer-ref-"
const HOUR = 60 * 60 * 1000

/** Delete snapshots of runs that were interrupted. */
const removeStaleSnapshots = (): void => {
  for (const entry of readdirSync(tmpdir())) {
    if (!entry.startsWith(SNAPSHOT_PREFIX)) continue
    const path = join(tmpdir(), entry)
    try {
      if (Date.now() - lstatSync(path).mtimeMs > HOUR) rmSync(path, { recursive: true, force: true })
    } catch {
      // Another user's, or deleted by another run.
    }
  }
}

/**
 * Recreate an installed `node_modules` for the snapshot. Third-party packages
 * link to the installed copy; a workspace package links to its own snapshot.
 */
const linkDependencies = (
  installed: string,
  linked: string,
  repo: string,
  snapshot: string,
  thirdParty: Set<string>
): void => {
  // A ref can track a link in its place, which leads to somewhere else.
  if (isLink(linked)) return
  mkdirSync(linked, { recursive: true })
  for (const entry of readdirSync(installed)) {
    if (entry.startsWith(".")) continue
    const from = join(installed, entry)
    const to = join(linked, entry)
    // A workspace package the ref does not have stays missing.
    if (!existsSync(from) || !statSync(from).isDirectory()) continue
    if (entry.startsWith("@")) {
      linkDependencies(from, to, repo, snapshot, thirdParty)
      continue
    }
    const real = realpathSync(from)
    const target = isRepoSource(real, repo) ? join(snapshot, relative(repo, real)) : real
    if (!existsSync(target) || existsSync(to) || isLink(to)) continue
    symlinkSync(target, to, "junction")
    if (target === real) thirdParty.add(to)
  }
}

/** Run `use` on a directory holding the ref's tracked files, then delete it. */
const withSnapshot = <A>(ref: string, cwd: string, use: (snapshot: Snapshot) => A): A => {
  removeStaleSnapshots()
  // realpath: tsgo reports real paths, and macOS's tmpdir is a symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), SNAPSHOT_PREFIX)))
  try {
    const repo = realpathSync(cwd)
    const snapshot = join(root, "tree")
    // A private index leaves the checkout and git's own index untouched.
    const env = { ...process.env, GIT_INDEX_FILE: join(root, "index"), GIT_LFS_SKIP_SMUDGE: "1" }
    const git = (args: ReadonlyArray<string>): string =>
      execFileSync("git", args, {
        cwd: repo,
        env,
        encoding: "utf-8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      })
    git(["read-tree", ref])
    // Every file: an `extends` target or a resolved module can have any name.
    git(["checkout-index", "--all", `--prefix=${snapshot}/`])
    const thirdParty = new Set<string>()
    const isOutside = (path: string): boolean =>
      !isInside(path, root) ||
      (existsSync(path) && !dirsUpTo(path, root).some((dir) => thirdParty.has(dir)) &&
        !isInside(realpathSync(path), root))
    const packageDirs = git(["ls-files", "-z"])
      .split("\0")
      .filter((p) => p === "package.json" || p.endsWith("/package.json"))
      .map((p) => dirname(p))
    for (const dir of new Set([".", ...packageDirs])) {
      const installed = join(repo, dir, "node_modules")
      if (existsSync(installed)) {
        linkDependencies(installed, join(snapshot, dir, "node_modules"), repo, snapshot, thirdParty)
      }
    }
    // Packages can also be installed above the repository.
    for (let dir = dirname(repo);; dir = dirname(dir)) {
      const installed = join(dir, "node_modules")
      if (existsSync(installed)) linkDependencies(installed, join(root, "node_modules"), repo, snapshot, thirdParty)
      if (dir === dirname(dir)) break
    }
    // The compiler looks for a project above the snapshot too, and takes the first it finds.
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: [] }))
    return use({ snapshot, repo, isOutside })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** Audits each file under the tsconfig it was checked under, setting each project up once. */
const makeProjectAudits = (at: Snapshot) => {
  const audits = new Map<string | undefined, (file: string) => Flaw | undefined>()
  return (file: string, checkedUnder: string | undefined): Flaw | undefined => {
    const config = checkedUnder ?? nearestTsconfig(dirname(file), at.snapshot)
    const outside = [file, config].find((path) => path !== undefined && at.isOutside(path))
    if (outside !== undefined) return { reason: `${outside} is not part of it`, missing: false }
    const audit = audits.get(config) ?? makeInputAudit(config, at)
    audits.set(config, audit)
    return audit(file)
  }
}

/** Checks the repository path paired with each item as it is at `ref`. */
export const checkAtRef = <A>(
  ref: string,
  items: ReadonlyArray<readonly [A, path: string]>,
  cwd: string
): ReadonlyArray<readonly [A, RefCheck]> => {
  if (items.length === 0) return []
  try {
    return withSnapshot(ref, cwd, (at) => {
      const { snapshot } = at
      const check = checkFilesWithTsgo(items.map(([, path]) => join(snapshot, path)), { within: snapshot })
      const audit = makeProjectAudits(at)
      const checkOf = (file: string): RefCheck => {
        if (!check.checked.has(file)) return { kind: "excluded" }
        const flaw = audit(file, check.checked.get(file))
        if (flaw && !flaw.missing) return { kind: "unavailable", reason: flaw.reason }
        const diagnostics = check.diagnostics.filter((d) => d.filePath === file)
        return flaw ? { kind: "incomplete", diagnostics, reason: flaw.reason } : { kind: "checked", diagnostics }
      }
      return items.map(([item, path]) => [item, checkOf(join(snapshot, path))] as const)
    })
  } catch (error) {
    const [reason = "unknown error"] = (error instanceof Error ? error.message : String(error)).split("\n")
    return items.map(([item]) => [item, { kind: "unavailable", reason }] as const)
  }
}
