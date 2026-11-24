/** What `package.json` files ask for. */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import semver from "semver"
import { dirsUpTo } from "./paths"

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {}

/** A directory's manifest, empty when there is none to read. */
export const readManifest = (dir: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")))
  } catch {
    return {}
  }
}

export interface Request {
  readonly dir: string
  readonly range: string
}

/** `npm:helper@^2.0.0`, as a dependency under another name is written. */
export const parseAlias = (spec: string): { readonly name: string; readonly range: string } | undefined => {
  const [, name, range = "*"] = /^npm:(@?[^@]+)(?:@(.*))?$/.exec(spec) ?? []
  return name !== undefined && semver.validRange(name) === null ? { name, range } : undefined
}

/** What the nearest manifest that lists a dependency asks for. */
export const requestOf = (key: string, from: string, root: string): Request | undefined => {
  for (const dir of dirsUpTo(from, root)) {
    const manifest = readManifest(dir)
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const range = asRecord(manifest[field])[key]
      if (typeof range === "string") return { dir, range }
    }
  }
  return undefined
}

/** The package manager a directory's project declares, in the nearest manifest that declares one. */
export const declaredManager = (from: string, root: string): string | undefined => {
  for (const dir of dirsUpTo(from, root)) {
    const { devEngines, packageManager } = readManifest(dir)
    if (typeof packageManager === "string") return packageManager.split("@")[0]
    const name = asRecord(asRecord(devEngines)["packageManager"])["name"]
    if (typeof name === "string") return name
  }
  return undefined
}
