/** Reads the lockfiles of the package managers, as far as they say who gets which version. */

import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import semver from "semver"
import { memoize } from "./memoize"
import { asRecord, declaredManager, parseAlias, readManifest, type Request } from "./package-manifest"
import { dirsUpTo, toPosix } from "./paths"
import { loadTsMorph } from "./ts-morph-loader"

interface Package {
  readonly name: string
  readonly version: string
}

export interface Lock {
  readonly file: string
  readonly path: string
  readonly manager: string
  readonly text: string
  /** Every recorded version of a package, whoever uses it. None if the format is not supported. */
  readonly versions: ReadonlyMap<string, ReadonlySet<string>>
  /** What source in `from` gets for a dependency, where the lockfile says. */
  readonly resolve: (key: string, from: string, request: Request | undefined) => Package | undefined
  /** The directories it also installs, relative to its own, where the lockfile says. */
  readonly workspaces: ReadonlySet<string>
}

type ReadLock = (text: string, lockDir: string) => Pick<Lock, "versions" | "resolve" | "workspaces">

const collect = (entries: Iterable<readonly [string, string]>): ReadonlyMap<string, ReadonlySet<string>> => {
  const versions = new Map<string, Set<string>>()
  for (const [name, version] of entries) versions.set(name, (versions.get(name) ?? new Set()).add(version))
  return versions
}

const unquote = (text: string): string => text.replace(/^(['"])(.*)\1$/, "$2")

const UNSUPPORTED: ReturnType<ReadLock> = { versions: new Map(), resolve: () => undefined, workspaces: new Set() }

const readPnpm: ReadLock = (text, lockDir) => {
  // Before 6, packages are keyed /name/1.0.0.
  if (/^lockfileVersion: '?[0-5]\b/m.test(text)) return UNSUPPORTED
  const importers = new Map<string, Map<string, Package>>()
  let section = ""
  let current = new Map<string, Package>()
  let isDependencies = false
  let name = ""
  // The file is machine-written, so its indentation is its structure.
  for (const line of text.split(/\r?\n/)) {
    const [, indent = "", key = "", value = ""] = /^( *)('[^']*'|"[^"]*"|[^\s:]+):(?: (.*))?$/.exec(line) ?? []
    if (key === "") {
      if (/^\S/.test(line)) section = ""
    } else if (indent.length === 0) section = key
    else if (section !== "importers") continue
    else if (indent.length === 2) {
      current = importers.get(unquote(key)) ?? new Map<string, Package>()
      importers.set(unquote(key), current)
    } else if (indent.length === 4) {
      isDependencies = ["dependencies", "devDependencies", "optionalDependencies"].includes(key)
    } else if (indent.length === 6) name = unquote(key)
    else if (indent.length === 8 && isDependencies && key === "version") {
      const resolved = unquote(value).replace(/\(.*$/, "").replace(/^\//, "")
      const [, alias, version = resolved] = /^(@?[^@]+)@(.+)$/.exec(resolved) ?? []
      if (semver.valid(version) !== null) current.set(name, { name: alias ?? name, version })
    }
  }
  // `name@1.2.3`, however the entry is quoted, and before any peer suffix.
  const entries = text.matchAll(/(?:^|[\s'"/(])((?:@[^\s@/'"()]+\/)?[^\s@/'"():]+)@(\d[^\s'"():,]*)/gm)
  return {
    versions: collect([...entries].map((m) => [m[1] ?? "", m[2] ?? ""] as const)),
    resolve: (key, _from, request) =>
      request && importers.get(toPosix(relative(lockDir, request.dir)) || ".")?.get(key),
    workspaces: new Set(importers.keys())
  }
}

interface NpmEntry {
  readonly name?: string
  readonly version?: string
  readonly dependencies?: Record<string, unknown>
}

/** Version 1 nests packages where later versions list their paths. */
const npmPaths = (tree: Record<string, unknown>, parent = ""): ReadonlyArray<readonly [string, NpmEntry]> =>
  Object.entries(tree as Record<string, NpmEntry>).flatMap(([key, { dependencies, version = "" }]) => {
    const path = `${parent}node_modules/${key}`
    const alias = parseAlias(version)
    const entry = alias ? { name: alias.name, version: alias.range } : { version }
    return [[path, entry] as const, ...npmPaths(asRecord(dependencies), `${path}/`)]
  })

const readNpm: ReadLock = (text, lockDir) => {
  const lock = asRecord(JSON.parse(text))
  const entries = lock["packages"] === undefined
    ? npmPaths(asRecord(lock["dependencies"]))
    : Object.entries(asRecord(lock["packages"]) as Record<string, NpmEntry>)
  const packages = new Map(
    entries.flatMap(([path, { name = path.split("node_modules/").at(-1) ?? path, version }]) =>
      // Linked packages have no version, and those from elsewhere a URL.
      version !== undefined && semver.valid(version) !== null ? [[path, { name, version }] as const] : []
    )
  )
  const paths = new Set(entries.map(([path]) => path))
  return {
    versions: collect([...packages.values()].map(({ name, version }) => [name, version] as const)),
    resolve: (key, from) => {
      const path = dirsUpTo(from, lockDir)
        .map((dir) => toPosix(join(relative(lockDir, dir), "node_modules", key)))
        .find((p) => paths.has(p))
      return path === undefined ? undefined : packages.get(path)
    },
    workspaces: new Set([...paths].filter((path) => !path.includes("node_modules/")))
  }
}

const readYarn: ReadLock = (text) => {
  const descriptors = new Map<string, Package>()
  for (const m of text.matchAll(/^(\S[^\n]*):\r?\n\s+version:? "?([^"\s]+)/gm)) {
    for (const descriptor of (m[1] ?? "").replaceAll("\"", "").split(", ")) {
      const [, key = descriptor, alias] = /^(@?[^@]+)@(?:npm:(@?[^@]+)@)?/.exec(descriptor) ?? []
      descriptors.set(descriptor, { name: alias ?? key, version: m[2] ?? "" })
    }
  }
  return {
    versions: collect([...descriptors.values()].map(({ name, version }) => [name, version] as const)),
    resolve: (key, _from, request) =>
      request && (descriptors.get(`${key}@${request.range}`) ?? descriptors.get(`${key}@npm:${request.range}`)),
    // Version 1 does not list them.
    workspaces: new Set([...descriptors.keys()].flatMap((d) => /@workspace:(.+)$/.exec(d)?.[1] ?? []))
  }
}

const readBun: ReadLock = (text) => {
  const { ts } = loadTsMorph()
  const lock = asRecord(ts.parseConfigFileTextToJson("bun.lock", text).config)
  const packages = new Map(
    Object.entries(asRecord(lock["packages"])).flatMap(([key, entry]) => {
      const id: unknown = Array.isArray(entry) ? entry[0] : undefined
      const [, name, version] = typeof id === "string" ? /^(.+)@(\d.*)$/.exec(id) ?? [] : []
      return name !== undefined && version !== undefined ? [[key, { name, version }] as const] : []
    })
  )
  return {
    versions: collect([...packages.values()].map(({ name, version }) => [name, version] as const)),
    resolve: (key, _from, request) => {
      if (!request) return undefined
      const workspace = readManifest(request.dir)["name"]
      return packages.get(`${String(workspace)}/${key}`) ?? packages.get(key)
    },
    workspaces: new Set(Object.keys(asRecord(lock["workspaces"])))
  }
}

/** In the order a package manager prefers its own files. */
const LOCKFILES: ReadonlyArray<{ readonly file: string; readonly manager: string; readonly read: ReadLock }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm", read: readPnpm },
  { file: "bun.lock", manager: "bun", read: readBun },
  { file: "bun.lockb", manager: "bun", read: () => UNSUPPORTED },
  { file: "npm-shrinkwrap.json", manager: "npm", read: readNpm },
  { file: "package-lock.json", manager: "npm", read: readNpm },
  { file: "yarn.lock", manager: "yarn", read: readYarn }
]

interface LockFile {
  readonly file: string
  readonly path: string
  readonly manager: string
  readonly read: ReadLock
}

/** The preferred lockfile of each package manager in a directory. */
const lockFilesIn = (dir: string): ReadonlyArray<LockFile> =>
  LOCKFILES
    .map((lock) => ({ ...lock, path: join(dir, lock.file) }))
    .filter(({ path }) => existsSync(path) && statSync(path).isFile())
    .filter((lock, i, all) => all.findIndex((l) => l.manager === lock.manager) === i)

const readLock = ({ file, manager, path, read }: LockFile): Lock => {
  let text = ""
  try {
    // A binary lockfile is only ever compared, which latin1 keeps exact.
    text = readFileSync(path, file === "bun.lockb" ? "latin1" : "utf-8")
    return { file, path, manager, text, ...read(text, dirname(path)) }
  } catch {
    return { file, path, manager, text, ...UNSUPPORTED }
  }
}

/** Finds the lockfiles that could be in use for source in a directory. */
export const makeLockFinder = (root: string): (from: string) => ReadonlyArray<Lock> => {
  const filesIn = memoize(lockFilesIn)
  const locks = new Map<string, Lock>()
  const lockOf = (file: LockFile): Lock => {
    const lock = locks.get(file.path) ?? readLock(file)
    locks.set(file.path, lock)
    return lock
  }
  return memoize((from) => {
    const dirs = dirsUpTo(from, root)
    const declared = declaredManager(from, root)
    const all = dirs.map((dir) => ({ dir, files: filesIn(dir) }))
    const ofDeclared = all.map(({ dir, files }) => ({ dir, files: files.filter((f) => f.manager === declared) }))
    const inUse = (ofDeclared.some(({ files }) => files.length > 0) ? ofDeclared : all)
      .map(({ dir, files }) => ({ dir, locks: files.map(lockOf) }))

    // A workspace is installed from its root, whatever else was left in it.
    const packageDir = dirs.find((dir) => existsSync(join(dir, "package.json"))) ?? root
    const ofWorkspace = inUse.map(({ dir, locks }) => {
      const workspace = toPosix(relative(dir, packageDir))
      return dir !== packageDir && locks.some((l) => l.workspaces.has(workspace)) ? locks : []
    })
    return [...ofWorkspace, ...inUse.map(({ locks }) => locks)].find((locks) => locks.length > 0) ?? []
  })
}
