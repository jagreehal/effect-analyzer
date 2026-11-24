/** Whether installed packages are the versions a git ref records. */

import { dirname, join, relative } from "node:path"
import semver from "semver"
import { type Lock, makeLockFinder } from "./lockfiles"
import { parseAlias, readManifest, type Request, requestOf } from "./package-manifest"
import { toPosix } from "./paths"

export interface Installed {
  readonly dir: string
  readonly name: string
  readonly version: string | undefined
}

/** The directory of the package a path is installed in, and the name it is installed under. */
const installedAt = (path: string): { readonly dir: string; readonly key: string } | undefined => {
  const [, dir, key] = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(toPosix(path)) ?? []
  return dir === undefined || key === undefined ? undefined : { dir, key }
}

/** The name source depends on a package by, given the unresolved path it found it at. */
export const dependencyKey = (path: string): string | undefined => installedAt(path)?.key

export const installedPackage = (path: string): Installed | undefined => {
  const read = (dir: string): Installed | undefined => {
    const { name, version } = readManifest(dir)
    return typeof name === "string"
      ? { dir, name, version: typeof version === "string" ? version : undefined }
      : undefined
  }
  // Not the nearest manifest: packages can have more of them inside.
  const installed = installedAt(path)
  if (installed) return read(installed.dir)
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
    const found = read(dir)
    if (found) return found
  }
  return undefined
}

export type Verdict = "same" | "other" | "unknown"

/** What a lockfile settles: the importer's own version, or the only one there is. */
const fromLock = (
  lock: Lock,
  inCheckout: ReadonlyArray<Lock>,
  { name, version }: { readonly name: string; readonly version: string },
  dependency: { readonly key: string; readonly from: string; readonly request: Request | undefined } | undefined
): Verdict | undefined => {
  const resolved = dependency && lock.resolve(dependency.key, dependency.from, dependency.request)
  if (resolved) return resolved.name === name && resolved.version === version ? "same" : "other"
  const recorded = lock.versions.get(name)
  if (recorded) return !recorded.has(version) ? "other" : recorded.size === 1 ? "same" : undefined
  // A package in neither lockfile is bundled in another, so is not a difference.
  return inCheckout.some((l) => l.versions.get(name)?.has(version)) ? "other" : undefined
}

/** What a range settles: that it rules the version out, or that it is an exact pin. */
const fromRange = (
  { name, version }: { readonly name: string; readonly version: string },
  key: string,
  request: Request
): Verdict | undefined => {
  const wanted = parseAlias(request.range) ?? { name: key, range: request.range }
  if (semver.validRange(wanted.range) === null) return undefined
  if (wanted.name !== name || !semver.satisfies(version, wanted.range)) return "other"
  return semver.valid(wanted.range) === null ? undefined : "same"
}

/**
 * Compares an installed package with what the ref in `snapshot` records for source
 * in `from`, which depends on it as `key`. Without a key the package was reached
 * through another installed one, and `from` only locates the lockfile.
 */
export const makeVersionCheck = (snapshot: string, repo: string, locksAtRef = makeLockFinder(snapshot)) => {
  const locksInCheckout = makeLockFinder(repo)

  return (installed: Pick<Installed, "name" | "version">, from: string, key: string | undefined): Verdict => {
    const { name, version } = installed
    const checkoutFrom = join(repo, relative(snapshot, from))
    const inCheckout = locksInCheckout(checkoutFrom)
    const request = key === undefined ? undefined : requestOf(key, from, snapshot)

    const verdictOf = (lock: Lock | undefined): Verdict => {
      if (version !== undefined) {
        const exact = { name, version }
        const settled =
          (lock && fromLock(lock, inCheckout, exact, key === undefined ? undefined : { key, from, request })) ??
            (request && key !== undefined ? fromRange(exact, key, request) : undefined)
        if (settled) return settled
      }
      // Nothing settles it, so base had this version unless what led to it has changed.
      const isRecorded = lock?.versions.has(name) ?? false
      if (lock && (isRecorded || lock.versions.size === 0)) {
        if (inCheckout.find((l) => l.file === lock.file)?.text !== lock.text) return "unknown"
        if (isRecorded) return "same"
      }
      if (!request || key === undefined) return "same"
      return requestOf(key, checkoutFrom, repo)?.range === request.range ? "same" : "unknown"
    }

    // Lockfiles of several package managers, none of them declared, have to agree.
    const [verdict = verdictOf(undefined), ...rest] = new Set(locksAtRef(from).map(verdictOf))
    return rest.length === 0 ? verdict : "unknown"
  }
}
