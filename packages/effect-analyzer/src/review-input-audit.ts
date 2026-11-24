/** Finds what a file's types depend on that is not from its git ref. */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { ts as Ts } from "ts-morph"
import { dependencyKey, type Installed, installedPackage, makeVersionCheck } from "./locked-versions"
import { makeLockFinder } from "./lockfiles"
import { memoize } from "./memoize"
import { dirsUpTo, isInside, toPosix } from "./paths"
import { loadTsMorph } from "./ts-morph-loader"

/** Source of this repository, as opposed to something installed into it. */
export const isRepoSource = (path: string, repo: string): boolean =>
  isInside(path, repo) && !relative(repo, path).split(sep).includes("node_modules")

/** A ref's tracked files in a directory of their own. */
export interface Snapshot {
  readonly snapshot: string
  readonly repo: string
  /** Whether a path leads out of it, by anything but a link to an installed package. */
  readonly isOutside: (path: string) => boolean
}

/** Something a ref's types depend on that is not the ref's. */
export interface Flaw {
  readonly reason: string
  /** Absent from git, so from the snapshot. Otherwise present, but not the ref's. */
  readonly missing: boolean
}

const absent = (reason: string): Flaw => ({ reason, missing: true })
const differing = (reason: string): Flaw => ({ reason, missing: false })

/** An input that differs outweighs a missing one: it can change types either way. */
const foremost = (flaws: ReadonlyArray<Flaw | undefined>): Flaw | undefined =>
  flaws.find((f) => f?.missing === false) ?? flaws.find((f) => f !== undefined)

interface Project {
  readonly options: Ts.CompilerOptions
  readonly files: ReadonlyArray<string>
  readonly errors: ReadonlyArray<number>
  readonly extended: ReadonlyArray<string>
  readonly references: ReadonlyArray<string>
}

const NO_PROJECT: Project = { options: {}, files: [], errors: [], extended: [], references: [] }

/** `at` says where a file is to be read from. */
const readProject = (path: string, at = (p: string): string => p): Project => {
  const { ts } = loadTsMorph()
  const host: Ts.ParseConfigHost = {
    ...ts.sys,
    fileExists: (p) => ts.sys.fileExists(at(p)),
    readFile: (p) => ts.sys.readFile(at(p))
  }
  const source = ts.readJsonConfigFile(path, (p) => host.readFile(p))
  const parsed = ts.parseJsonSourceFileConfigFileContent(source, host, dirname(path), undefined, path)
  return {
    options: parsed.options,
    files: parsed.fileNames,
    errors: parsed.errors.map((e) => e.code),
    extended: source.extendedSourceFiles ?? [],
    references: (parsed.projectReferences ?? []).map((r) => r.path)
  }
}

const isGitIgnored = (path: string, repo: string): boolean => {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", path], { cwd: repo, stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const allowsJs = (options: Ts.CompilerOptions): boolean => (options.allowJs ?? options.checkJs) === true

const loadsInstalledJs = (options: Ts.CompilerOptions): boolean =>
  allowsJs(options) && (options.maxNodeModuleJsDepth ?? 0) > 0

const isJs = (path: string): boolean => /\.[cm]?jsx?$/.test(path)

const isInstalledJs = (path: string): boolean => isJs(path) && toPosix(path).includes("/node_modules/")

/**
 * Whether TypeScript takes a file with no imports or exports for a module all the same:
 * for CommonJS, or because it is told to. Only a program's files are classified.
 */
const isModuleWithoutSyntax = (path: string, options: Ts.CompilerOptions): boolean => {
  const { ts } = loadTsMorph()
  const program = ts.createProgram([path], { ...options, noLib: true, noResolve: true, types: [] })
  // Creating the checker is what looks for the marks of CommonJS.
  program.getTypeChecker()
  const file = program.getSourceFile(path)
  const { isExternalOrCommonJsModule } = ts as typeof ts & {
    readonly isExternalOrCommonJsModule: (file: Ts.SourceFile) => boolean
  }
  return file !== undefined && isExternalOrCommonJsModule(file)
}

/** Whether a file changes types it is not imported by: ambient or augmenting. */
const affectsGlobals = (file: Ts.SourceFile, options: Ts.CompilerOptions): boolean => {
  const { ts } = loadTsMorph()
  const { fileName } = file
  const isLoaded = isJs(fileName)
    ? allowsJs(options) && (!isInstalledJs(fileName) || loadsInstalledJs(options))
    : /\.[cm]?tsx?$/.test(fileName)
  if (!isLoaded) return false
  const augments = file.statements.some((statement) =>
    ts.isModuleDeclaration(statement) &&
    (ts.isStringLiteral(statement.name) || (statement.flags & ts.NodeFlags.GlobalAugmentation) !== 0)
  )
  if (augments || ts.isExternalModule(file)) return augments
  return file.isDeclarationFile || !isModuleWithoutSyntax(fileName, options)
}

/** The JavaScript of packages that TypeScript loads for `files`. It can resolve to more. */
const loadedInstalledJs = (files: ReadonlyArray<string>, options: Ts.CompilerOptions): ReadonlySet<string> => {
  if (!loadsInstalledJs(options)) return new Set()
  const { ts } = loadTsMorph()
  return new Set(
    ts.createProgram(files, { ...options, noLib: true }).getSourceFiles()
      .filter(({ fileName }) => isInstalledJs(fileName))
      .map(({ fileName }) => realpathSync(fileName))
  )
}

/** `roots` and all that `next` leads to from them. */
const reachable = (roots: Iterable<string>, next: (path: string) => Iterable<string>): ReadonlySet<string> => {
  const seen = new Set(roots)
  // Files appended while iterating are visited too.
  for (const path of seen) for (const target of next(path)) seen.add(target)
  return seen
}

const sameContent = (left: string, right: string): boolean => {
  try {
    return readFileSync(left).equals(readFileSync(right))
  } catch {
    return false
  }
}

/** The module names a file refers to, as the nodes TypeScript takes their resolution mode from. */
const moduleNames = (file: Ts.SourceFile): ReadonlyArray<Ts.StringLiteralLike> => {
  const { ts } = loadTsMorph()
  const names: Array<Ts.StringLiteralLike> = []
  const inJs = isJs(file.fileName)
  const nameIn = (node: Ts.Node): Ts.Node | undefined => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
    if (ts.isJSDocImportTag(node)) return node.moduleSpecifier
    if (ts.isExternalModuleReference(node)) return node.expression
    if (ts.isImportTypeNode(node)) return ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined
    if (ts.isModuleDeclaration(node)) return ts.isExternalModule(file) ? node.name : undefined
    if (!ts.isCallExpression(node)) return undefined
    const isRequire = inJs && ts.isIdentifier(node.expression) && node.expression.text === "require"
    return isRequire || node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined
  }
  const visit = (node: Ts.Node): void => {
    const name = nameIn(node)
    if (name && ts.isStringLiteralLike(name)) names.push(name)
    // Where JavaScript has its types.
    if (inJs) (node as { readonly jsDoc?: ReadonlyArray<Ts.Node> }).jsDoc?.forEach(visit)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return names
}

interface Reference {
  readonly kind: "module" | "types" | "file"
  readonly name: string
  readonly mode: Ts.ResolutionMode
}

/** Resolves what source in one tree refers to, as TypeScript does under its options. */
const makeResolver = (root: string, projectOptions: Ts.CompilerOptions) => {
  const { ts } = loadTsMorph()
  // Where a link points loses the name it is depended on by.
  const options = { ...projectOptions, preserveSymlinks: true }
  const cache = ts.createModuleResolutionCache(root, (p) => p, options)

  const resolveReference = ({ kind, mode, name }: Reference, from: string): string | undefined => {
    switch (kind) {
      case "module":
        return ts.resolveModuleName(name, from, options, ts.sys, cache, undefined, mode).resolvedModule
          ?.resolvedFileName
      case "types":
        return ts.resolveTypeReferenceDirective(name, from, options, ts.sys, undefined, undefined, mode)
          .resolvedTypeReferenceDirective?.resolvedFileName
      case "file": {
        const target = resolve(dirname(from), name)
        return existsSync(target) ? target : undefined
      }
    }
  }

  const read = (path: string): { readonly affectsGlobals: boolean; readonly references: ReadonlyArray<Reference> } => {
    const text = ts.sys.readFile(path)
    if (text === undefined) return { affectsGlobals: false, references: [] }
    const impliedNodeFormat = ts.getImpliedNodeFormatForFile(path, cache.getPackageJsonInfoCache(), ts.sys, options)
    const file = ts.createSourceFile(path, text, { languageVersion: ts.ScriptTarget.Latest, impliedNodeFormat }, true)
    const references = [
      ...moduleNames(file).map((node): Reference => ({
        kind: "module",
        name: node.text,
        mode: ts.getModeForUsageLocation(file, node, options)
      })),
      ...file.typeReferenceDirectives.map((f): Reference => ({
        kind: "types",
        name: f.fileName,
        mode: f.resolutionMode ?? impliedNodeFormat
      })),
      ...file.referencedFiles.map((f): Reference => ({ kind: "file", name: f.fileName, mode: undefined }))
    ]
    return { affectsGlobals: affectsGlobals(file, options), references }
  }

  return { resolveReference, read }
}

/** Where a reference leads, and the name of the dependency it goes through. */
interface Target {
  readonly path: string
  readonly key: string | undefined
  readonly isOutside?: boolean
}

const targetAt = (found: string): Target => ({ path: realpathSync(found), key: dependencyKey(found) })

/**
 * Audits the files of one project: for an input that only the checkout has
 * (generated code, build output), one read from the checkout where it differs from
 * the ref (a workspace package reached through an installed one), or an installed
 * package at another version than the ref records.
 */
export const makeInputAudit = (configPath: string | undefined, { isOutside, repo, snapshot }: Snapshot) => {
  const inCheckout = (path: string): string => join(repo, relative(snapshot, path))
  const inSnapshot = (path: string): string => join(snapshot, relative(repo, path))

  const project = configPath === undefined ? NO_PROJECT : readProject(configPath)
  // The ref's configuration still, whatever the checkout's says, with all that is in the checkout.
  const projectInCheckout = configPath === undefined
    ? NO_PROJECT
    : readProject(inCheckout(configPath), (p) => isInside(p, repo) && existsSync(inSnapshot(p)) ? inSnapshot(p) : p)
  const atRef = makeResolver(snapshot, project.options)
  const atCheckout = makeResolver(repo, projectInCheckout.options)

  const targetFrom = (path: string, found: string): Target => ({
    ...targetAt(found),
    isOutside: isInside(path, snapshot) && isOutside(found)
  })

  const referencesOf = memoize((path) => {
    const targets: Array<Target> = []
    const missing: Array<{ readonly specifier: string; readonly target: string }> = []
    const { affectsGlobals, references } = atRef.read(path)
    for (const reference of references) {
      const found = atRef.resolveReference(reference, path)
      if (found !== undefined) {
        targets.push(targetFrom(path, found))
        continue
      }
      const target = isInside(path, snapshot) ? atCheckout.resolveReference(reference, inCheckout(path)) : undefined
      if (target !== undefined) missing.push({ specifier: reference.name, target })
    }
    return { affectsGlobals, targets, missing }
  })
  const targetsOf = (path: string): ReadonlyArray<string> => referencesOf(path).targets.map((t) => t.path)
  /** With those that resolve in the checkout alone, so are not part of the ref. */
  const anyTargetsOf = (path: string): ReadonlyArray<string> => [
    ...targetsOf(path),
    ...referencesOf(path).missing.map((m) => m.target)
  ]
  const isAmbient = (path: string, loadedJs: ReadonlySet<string>): boolean =>
    referencesOf(path).affectsGlobals && (!isInstalledJs(path) || loadedJs.has(path))

  const fromCheckout = (path: string): Flaw | undefined =>
    isRepoSource(path, repo) && !sameContent(path, inSnapshot(path))
      ? differing(`${relative(repo, path)} is read from the checkout`)
      : undefined

  const locksAtRef = makeLockFinder(snapshot)
  const linkedManifestIn = memoize((dir) =>
    [...dirsUpTo(dir, snapshot).map((d) => join(d, "package.json")), ...locksAtRef(dir).map((lock) => lock.path)]
      .find((manifest) => isOutside(manifest))
  )
  /** Set if what decides the versions and the resolution of a file's imports is not the ref's. */
  const fromLinkedManifest = (path: string): Flaw | undefined => {
    const linked = isInside(path, snapshot) ? linkedManifestIn(dirname(path)) : undefined
    return linked === undefined ? undefined : differing(`${relative(snapshot, linked)} is not part of it`)
  }

  const versionOf = makeVersionCheck(snapshot, repo, locksAtRef)
  const packageIn = memoize((dir): Installed | undefined => installedPackage(join(dir, "_")))
  const packageOf = (path: string) => packageIn(dirname(path))

  /** Set unless what `from` refers to is installed at the version the ref records. */
  const otherVersion = (from: string, { key, path, ...target }: Target): Flaw | undefined => {
    if (target.isOutside) return differing(`${path} is not part of it`)
    if (isInside(path, snapshot) || isRepoSource(path, repo)) return undefined
    const pkg = packageOf(path)
    const isImporter = isInside(from, snapshot)
    if (pkg === undefined || (!isImporter && packageOf(from)?.dir === pkg.dir)) return undefined
    const verdict = isImporter
      ? versionOf(pkg, dirname(from), key ?? pkg.name)
      : versionOf(pkg, configPath === undefined ? snapshot : dirname(configPath), undefined)
    switch (verdict) {
      case "same":
        return undefined
      case "other":
        return differing(
          `the installed ${pkg.name}${
            pkg.version === undefined ? "" : ` ${pkg.version}`
          } is not the version recorded there`
        )
      case "unknown":
        return differing(`the version of ${pkg.name} used there is not known`)
    }
  }

  const always = (): boolean => true

  /** The foremost flaw of `paths` and what they refer to: what is there if it `matters`, what is not if it `isMissed`. */
  const findFlaw = (
    paths: Iterable<string>,
    matters: (path: string) => boolean,
    isMissed: (path: string) => boolean
  ): Flaw | undefined => {
    let firstAbsent: Flaw | undefined
    for (const path of paths) {
      const read = fromCheckout(path) ?? fromLinkedManifest(path)
      if (read && matters(path)) return read
      const { missing, targets } = referencesOf(path)
      for (const target of targets) {
        const other = otherVersion(path, target)
        if (other && matters(target.path)) return other
      }
      const gone = missing.find(({ target }) => isMissed(target))
      if (gone) firstAbsent ??= absent(`'${gone.specifier}' does not resolve there`)
    }
    return firstAbsent
  }

  /** Set if the project takes anything from around the snapshot. Packages are reached by links to them. */
  const outsideFlaw = (): Flaw | undefined => {
    const isInstalled = (path: string): boolean =>
      dependencyKey(path) !== undefined && projectInCheckout.extended.includes(path)
    const outside = [...project.files, ...project.references, ...project.extended.filter((f) => !isInstalled(f))]
      .find((path) => isOutside(resolve(path)))
    return outside === undefined ? undefined : differing(`${outside} is not part of it`)
  }

  const extendedFlaws = (config: string): ReadonlyArray<Flaw | undefined> => [
    outsideFlaw(),
    fromLinkedManifest(config),
    ...project.extended.filter((f) => existsSync(f)).map(targetAt)
      .flatMap((target) => [fromCheckout(target.path), otherVersion(config, target)]),
    project.errors.some((code) => !projectInCheckout.errors.includes(code))
      ? absent(`${relative(snapshot, config)} does not resolve there`)
      : undefined
  ]

  /** What every file of the project gets, whatever it imports. */
  const ambientFlaws = (config: string): ReadonlyArray<Flaw | undefined> => {
    const { ts } = loadTsMorph()
    const from = join(dirname(config), "_.ts")
    const types = ts.getAutomaticTypeDirectiveNames(projectInCheckout.options, ts.sys).map((name) => {
      const reference: Reference = { kind: "types", name, mode: undefined }
      const found = atRef.resolveReference(reference, from)
      const isMissing = found === undefined && atCheckout.resolveReference(reference, inCheckout(from)) !== undefined
      return { name, isMissing, target: found === undefined ? undefined : targetFrom(from, found) }
    })
    const typesFiles = types.flatMap(({ target }) => target ? [target.path] : [])
    const roots = [...project.files.map((f) => resolve(f)), ...typesFiles]
    const program = reachable(roots, targetsOf)
    const untracked = projectInCheckout.files.filter((f) => isRepoSource(f, repo) && !existsSync(inSnapshot(f)))

    // Globals can be declared behind any number of imports. A package matters if
    // without it, whatever version base had, there would be fewer of them.
    const loadedJs = loadedInstalledJs(project.files, project.options)
    const ambient = new Set([...program].filter((path) => isAmbient(path, loadedJs)))
    const holdsGlobals = memoize((dir) => {
      const rest = reachable(roots, (path) => targetsOf(path).filter((target) => packageOf(target)?.dir !== dir))
      return [...ambient].some((path) => !rest.has(path))
    })
    const matters = (path: string): boolean => {
      const pkg = packageOf(path)
      return pkg === undefined ? ambient.has(path) : holdsGlobals(pkg.dir)
    }
    // Most of what is missing leads only to globals that are there anyway.
    const isPresent = (path: string): boolean =>
      ambient.has(path) || (isRepoSource(path, repo) && ambient.has(inSnapshot(path)))
    const addsGlobals = (path: string): boolean => {
      // Loaded for its sake, whatever else in the checkout loads it too.
      const loadedForIt = loadedInstalledJs([path], projectInCheckout.options)
      return [...reachable([path], anyTargetsOf)].some((p) => isAmbient(p, loadedForIt) && !isPresent(p))
    }

    // Not in git at all, so not in the ref either, unlike a file the change adds.
    const generated = untracked.find((f) => addsGlobals(f) && isGitIgnored(f, repo))
    return [
      generated === undefined ? undefined : absent(`${relative(repo, generated)} is not in git`),
      ...types.map(({ isMissing, name, target }) =>
        target
          ? otherVersion(config, target)
          : isMissing
          ? absent(`types '${name}' does not resolve there`)
          : undefined
      ),
      findFlaw(program, matters, addsGlobals),
      findFlaw(reachable([...typesFiles, ...ambient], targetsOf), always, always)
    ]
  }

  const projectFlaw = configPath === undefined
    ? undefined
    : foremost([...extendedFlaws(configPath), ...ambientFlaws(configPath)])

  return (file: string): Flaw | undefined =>
    projectFlaw?.missing === false
      ? projectFlaw
      : foremost([projectFlaw, findFlaw(reachable([file], targetsOf), always, always)])
}
