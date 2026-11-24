import { dirname, isAbsolute, relative, sep } from "node:path"

export const isInside = (path: string, root: string): boolean => {
  const rel = relative(root, path)
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** `from` and its ancestors, up to and including `root`. */
export const dirsUpTo = (from: string, root: string): ReadonlyArray<string> => {
  const dirs: Array<string> = []
  for (let dir = from; isInside(dir, root); dir = dirname(dir)) dirs.push(dir)
  return [...dirs, root]
}

export const toPosix = (path: string): string => path.split(sep).join("/")
