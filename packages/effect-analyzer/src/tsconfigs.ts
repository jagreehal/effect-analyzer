/** Finds the tsconfig whose project a file is part of. */

import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { memoize } from "./memoize"
import { loadTsMorph } from "./ts-morph-loader"

/** Those in `from` and its ancestors, innermost first, up to `within` or the repository's root. */
const tsconfigsAround = (from: string, within?: string): ReadonlyArray<string> => {
  const configs: Array<string> = []
  for (let dir = resolve(from);; dir = dirname(dir)) {
    const config = join(dir, "tsconfig.json")
    if (existsSync(config)) configs.push(config)
    const isRoot = dir === within || dir === dirname(dir) || (configs.length > 0 && existsSync(join(dir, ".git")))
    if (isRoot) return configs
  }
}

const readMembers = (config: string) => {
  const { ts } = loadTsMorph()
  const source = ts.readJsonConfigFile(config, (path) => ts.sys.readFile(path))
  const parsed = ts.parseJsonSourceFileConfigFileContent(source, ts.sys, dirname(config), undefined, config)
  const raw = parsed.raw as { readonly files?: unknown; readonly include?: unknown }
  return {
    files: new Set(parsed.fileNames.map((f) => resolve(f))),
    /** Includes everything around it, for want of saying what. */
    isImplicit: raw.files === undefined && raw.include === undefined,
    extended: (source.extendedSourceFiles ?? []).map((f) => resolve(f)),
    references: (parsed.projectReferences ?? []).map((r) => resolve(ts.resolveProjectReferencePath(r)))
      .filter((path) => existsSync(path))
  }
}

export const nearestTsconfig = (dir: string, within?: string): string | undefined => tsconfigsAround(dir, within)[0]

/**
 * The innermost tsconfig around a file that includes it, itself or through a project
 * it references. None includes a file that is only reached by imports.
 */
export const makeTsconfigFinder = (within?: string): (file: string) => string | undefined => {
  const membersOf = memoize(readMembers)
  const configsIn = memoize((dir) => tsconfigsAround(dir, within))
  return (file) => {
    const candidates = new Set<string>()
    const extended = new Set<string>()
    for (const config of configsIn(dirname(file))) {
      // A base for the others, which would have the whole repository checked.
      if (extended.has(config) && membersOf(config).isImplicit) continue
      candidates.add(config)
      // References added while iterating are visited too, before the next tsconfig out.
      for (const candidate of candidates) {
        const { extended: bases, files, references } = membersOf(candidate)
        if (files.has(file)) return candidate
        for (const base of bases) extended.add(base)
        for (const reference of references) candidates.add(reference)
      }
    }
    return undefined
  }
}
