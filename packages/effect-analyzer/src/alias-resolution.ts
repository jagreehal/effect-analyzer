/**
 * Alias and module resolution for Effect: file-level alias caches,
 * barrel resolution, and Effect-like call detection.
 */

import type { SourceFile, CallExpression, PropertyAccessExpression } from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import {
  PATH_SEPARATOR,
  dirnamePath,
  resolvePath,
  joinPath,
  hasPathPrefix,
} from './path-utils';
import {
  API_PREFIXES,
  isEffectPackageSpecifier,
  EFFECT_NAMESPACE_NAMES,
  KNOWN_INTERNAL_MODULES,
} from './analysis-patterns';

// =============================================================================
// Caches
// =============================================================================

/** Per-SourceFile alias cache — avoids global mutable state and races. */
const effectAliasCache = new WeakMap<SourceFile, Set<string>>();

/** Per-SourceFile symbol-resolution cache — avoids repeated TypeChecker lookups. */
const symbolResolutionCache = new WeakMap<SourceFile, Map<string, boolean>>();

interface FsModuleLike {
  readonly existsSync?: (path: string) => boolean;
}

const getNodeExistsSync = (): ((path: string) => boolean) | undefined => {
  const maybeProcess = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => unknown };
    }
  ).process;
  const fsBuiltin =
    maybeProcess?.getBuiltinModule?.('node:fs') ??
    maybeProcess?.getBuiltinModule?.('fs');

  if (!fsBuiltin || typeof fsBuiltin !== 'object') {
    return undefined;
  }

  return (fsBuiltin as FsModuleLike).existsSync;
};

// =============================================================================
// Barrel and re-export resolution
// =============================================================================

/**
 * Names that a barrel file re-exports from Effect (export { X } from 'effect' or export * from 'effect').
 * One level only; does not follow barrel → barrel.
 */
export function getNamesReExportedFromEffect(barrelSourceFile: SourceFile): Set<string> {
  const out = new Set<string>();
  for (const decl of barrelSourceFile.getExportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier || !isEffectPackageSpecifier(specifier)) continue;
    if (decl.isNamespaceExport()) {
      EFFECT_NAMESPACE_NAMES.forEach((n) => out.add(n));
      continue;
    }
    for (const named of decl.getNamedExports()) {
      out.add(named.getName());
      const alias = named.getAliasNode()?.getText();
      if (alias) out.add(alias);
    }
  }
  return out;
}

/**
 * Resolve a relative module specifier to a SourceFile in the project (21.5 barrel).
 * Tries exact path and common extensions / index files.
 */
export function resolveBarrelSourceFile(
  project: { getSourceFile: (path: string) => SourceFile | undefined },
  currentFilePath: string,
  specifier: string,
): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const baseDir = dirnamePath(currentFilePath);
  const resolved = resolvePath(baseDir, specifier);
  const candidates: string[] = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    joinPath(resolved, 'index.ts'),
    joinPath(resolved, 'index.tsx'),
    joinPath(resolved, 'index.js'),
    joinPath(resolved, 'index.jsx'),
  ];
  for (const p of candidates) {
    const f = project.getSourceFile(p);
    if (f) return f;
  }
  return undefined;
}

/**
 * Resolve a relative module specifier to an absolute path (first candidate that exists).
 * Used to add a referenced file to the project when symbol resolution doesn't load it.
 */
export function resolveModulePath(
  currentFilePath: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const existsSync = getNodeExistsSync();
  if (!existsSync) {
    return undefined;
  }

  const baseDir = dirnamePath(currentFilePath);
  const resolved = resolvePath(baseDir, specifier);
  const candidates: string[] = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    joinPath(resolved, 'index.ts'),
    joinPath(resolved, 'index.tsx'),
    joinPath(resolved, 'index.js'),
    joinPath(resolved, 'index.jsx'),
  ];
  return candidates.find((p) => existsSync(p));
}

/**
 * Returns true when a relative import specifier resolves to a path at or under
 * the configured Effect internals root. Extensionless resolution is intentional:
 * imports often point at `./internal/foo.js` while callers pass the folder root.
 */
export function isSpecifierUnderKnownEffectInternalsRoot(
  currentFilePath: string,
  specifier: string,
  knownEffectInternalsRoot?: string,
): boolean {
  if (!knownEffectInternalsRoot || !specifier.startsWith('.')) return false;
  const normalizedSpecifier = specifier.replace(/\\/g, '/');
  const normalizedResolved = resolvePath(dirnamePath(currentFilePath), specifier);
  const normalizedRoot = resolvePath(knownEffectInternalsRoot);
  if (hasPathPrefix(normalizedResolved, normalizedRoot)) {
    return true;
  }

  // `analyze.source(...)` uses an in-memory synthetic file path (e.g. `temp.ts`),
  // so path resolution cannot be related to the caller-provided internals root.
  // Preserve regression coverage in source-mode while keeping path resolution primary
  // for real files.
  const isSyntheticSourcePath =
    currentFilePath === 'temp.ts' ||
    currentFilePath.endsWith(`${PATH_SEPARATOR}temp.ts`);
  if (isSyntheticSourcePath) {
    return normalizedSpecifier.startsWith('./internal/') || normalizedSpecifier.startsWith('../internal/');
  }

  return false;
}

/** Gap 5 / 21.5: Collect names that refer to Effect (from 'effect', 'effect/*', '@effect/*', or barrel re-exports). */
export function getEffectImportNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>(EFFECT_NAMESPACE_NAMES);
  const project = sourceFile.getProject();
  const currentPath = sourceFile.getFilePath();

  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (isEffectPackageSpecifier(specifier)) {
      const def = decl.getDefaultImport();
      if (def) names.add(def.getText());
      const ns = decl.getNamespaceImport();
      if (ns) names.add(ns.getText());
      for (const named of decl.getNamedImports()) {
        const alias = named.getAliasNode()?.getText();
        names.add(alias ?? named.getName());
      }
      continue;
    }
    if (specifier.startsWith('.')) {
      const barrelFile = resolveBarrelSourceFile(project, currentPath, specifier);
      if (!barrelFile) continue;
      const reExported = getNamesReExportedFromEffect(barrelFile);

      // Collect all import names to check
      const toCheck: { name: string; localName: string }[] = [];
      const def = decl.getDefaultImport();
      if (def) {
        const text = def.getText();
        toCheck.push({ name: text, localName: text });
      }
      const ns = decl.getNamespaceImport();
      if (ns) {
        const text = ns.getText();
        toCheck.push({ name: text, localName: text });
      }
      for (const named of decl.getNamedImports()) {
        toCheck.push({
          name: named.getName(),
          localName: named.getAliasNode()?.getText() ?? named.getName(),
        });
      }

      // Fast path: check one-level re-exports first
      let needsDeepTrace = false;
      for (const entry of toCheck) {
        if (reExported.has(entry.name)) {
          names.add(entry.localName);
        } else {
          needsDeepTrace = true;
        }
      }

      // Slow path: only trace deeper when one-level check missed some imports
      if (needsDeepTrace) {
        for (const entry of toCheck) {
          if (!reExported.has(entry.name) && traceReExportChain(barrelFile, entry.name, project, 3)) {
            names.add(entry.localName);
          }
        }
      }
    }
  }
  return names;
}

/**
 * Enhanced alias set: includes standard Effect import names PLUS namespace
 * imports from known internal modules (e.g. `import * as core from "./core"`).
 */
export function getEffectLikeNamespaceAliases(
  sourceFile: SourceFile,
  knownEffectInternalsRoot?: string,
): Set<string> {
  const aliases = getEffectImportNames(sourceFile);

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();
    const namespaceImport = importDecl.getNamespaceImport();
    if (!namespaceImport) continue;

    const aliasName = namespaceImport.getText();

    if (moduleSpecifier.startsWith('effect') || moduleSpecifier.startsWith('@effect/')) {
      aliases.add(aliasName);
      continue;
    }

    if (
      isSpecifierUnderKnownEffectInternalsRoot(
        sourceFile.getFilePath(),
        moduleSpecifier,
        knownEffectInternalsRoot,
      )
    ) {
      aliases.add(aliasName);
      continue;
    }

    const basename = moduleSpecifier.replace(/\.(js|ts)$/, '').split('/').pop() ?? '';
    if (KNOWN_INTERNAL_MODULES.has(basename)) {
      aliases.add(aliasName);
    }
  }

  return aliases;
}

const NON_PROGRAM_EFFECT_MODULE_BASENAMES = new Set([
  'BigDecimal',
  'BigInt',
  'Brand',
  'Cause',
  'Chunk',
  'Data',
  'Exit',
  'Option',
  'Either',
  'HashMap',
  'HashSet',
  'List',
  'Redacted',
]);

/**
 * Local import names that come from Effect utility/data modules we do not want to
 * treat as direct "program" roots (e.g. Option.some / Either.right).
 */
export function getNonProgramEffectImportNames(sourceFile: SourceFile): Set<string> {
  const out = new Set<string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const normalized = specifier.replace(/\\/g, '/').replace(/\.(js|ts|tsx|jsx)$/, '');
    const basename = normalized.split('/').pop() ?? '';
    if (!NON_PROGRAM_EFFECT_MODULE_BASENAMES.has(basename)) continue;

    const def = importDecl.getDefaultImport();
    if (def) out.add(def.getText());
    const ns = importDecl.getNamespaceImport();
    if (ns) out.add(ns.getText());
    for (const named of importDecl.getNamedImports()) {
      out.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }

  return out;
}

// =============================================================================
// Public alias accessor (cached)
// =============================================================================

export function getAliasesForFile(sf: SourceFile): Set<string> {
  let aliases = effectAliasCache.get(sf);
  if (!aliases) {
    aliases = getEffectLikeNamespaceAliases(sf);
    effectAliasCache.set(sf, aliases);
  }
  return aliases;
}

/** Cache: sourceFile -> (local alias -> canonical Effect namespace, e.g. "L" -> "Layer"). */
const effectSubmoduleAliasCache = new WeakMap<SourceFile, Map<string, string>>();

/**
 * Derive the canonical Effect namespace from a module specifier.
 * - "effect" or "effect/Effect" -> "Effect"
 * - "effect/Layer" -> "Layer", "effect/Stream" -> "Stream", etc.
 */
function canonicalNamespaceFromSpecifier(specifier: string): string {
  const n = specifier.replace(/\\/g, '/').replace(/\.(js|ts|mts|cts)$/, '');
  if (n === 'effect' || n.endsWith('/Effect')) return 'Effect';
  const segment = n.split('/').pop() ?? '';
  return segment || 'Effect';
}

/**
 * Returns a map from local namespace alias to canonical Effect submodule name.
 * E.g. import * as L from "effect/Layer" => L -> "Layer".
 * Used to normalize callees like L.succeed to Layer.succeed for layer/stream detection.
 */
export function getEffectSubmoduleAliasMap(sourceFile: SourceFile): Map<string, string> {
  let map = effectSubmoduleAliasCache.get(sourceFile);
  if (map) return map;
  map = new Map();
  for (const decl of sourceFile.getImportDeclarations()) {
    const specifier = decl.getModuleSpecifierValue();
    if (!specifier || !isEffectPackageSpecifier(specifier)) continue;

    // Handle namespace imports: import * as L from "effect/Layer" => L -> Layer
    const nsImport = decl.getNamespaceImport();
    if (nsImport) {
      const aliasName = nsImport.getText();
      const canonical = canonicalNamespaceFromSpecifier(specifier);
      map.set(aliasName, canonical);
      continue;
    }

    // Handle named imports with aliases: import { Match as M } from "effect" => M -> Match
    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode()?.getText();
      if (alias) {
        const originalName = named.getName();
        map.set(alias, originalName);
      }
    }
  }
  effectSubmoduleAliasCache.set(sourceFile, map);
  return map;
}

/**
 * Normalize a callee string using the file's Effect submodule alias map.
 * E.g. "L.succeed" with L -> Layer becomes "Layer.succeed".
 */
export function normalizeEffectCallee(callee: string, sourceFile: SourceFile): string {
  const dotIdx = callee.indexOf('.');
  if (dotIdx <= 0) return callee;
  const ns = callee.slice(0, dotIdx);
  const rest = callee.slice(dotIdx + 1);
  const aliasMap = getEffectSubmoduleAliasMap(sourceFile);
  const canonical = aliasMap.get(ns);
  if (!canonical) return callee;
  return `${canonical}.${rest}`;
}

// =============================================================================
// Module origin resolution
// =============================================================================

/**
 * Trace a re-export chain up to `maxDepth` levels to determine if a name
 * ultimately originates from an Effect package.
 */
function traceReExportChain(
  barrelFile: SourceFile,
  name: string,
  project: { getSourceFile: (path: string) => SourceFile | undefined },
  maxDepth: number,
): boolean {
  if (maxDepth <= 0) return false;

  for (const exportDecl of barrelFile.getExportDeclarations()) {
    const specifier = exportDecl.getModuleSpecifierValue();
    if (!specifier) continue;

    // Check if this export contains the name, and resolve the original name
    // through any alias (e.g. export { E as Fx } — name="Fx", originalName="E")
    let originalName: string | undefined;
    if (exportDecl.isNamespaceExport()) {
      originalName = name; // namespace re-export covers all names unchanged
    } else {
      for (const namedExport of exportDecl.getNamedExports()) {
        const alias = namedExport.getAliasNode()?.getText();
        if (alias === name) {
          // export { E as Fx } — looking for "Fx", original is "E"
          originalName = namedExport.getName();
          break;
        }
        if (namedExport.getName() === name) {
          // export { E } — no rename
          originalName = name;
          break;
        }
      }
    }

    if (originalName === undefined) continue;

    // If it re-exports from an Effect package, we found it
    if (isEffectPackageSpecifier(specifier)) return true;

    // If it re-exports from a local module, recurse with the original name
    if (specifier.startsWith('.')) {
      const nextBarrel = resolveBarrelSourceFile(project, barrelFile.getFilePath(), specifier);
      if (nextBarrel) {
        const fromEffect = getNamesReExportedFromEffect(nextBarrel);
        if (fromEffect.has(originalName)) return true;
        if (traceReExportChain(nextBarrel, originalName, project, maxDepth - 1)) return true;
      }
    }
  }

  return false;
}

/**
 * Resolve whether a callee expression originates from an Effect package
 * by tracing its import declaration. Fallback when API_PREFIXES and alias checks don't match.
 */
function resolveCalleeModuleOrigin(calleeText: string, sourceFile: SourceFile): boolean {
  let cache = symbolResolutionCache.get(sourceFile);
  if (!cache) {
    cache = new Map();
    symbolResolutionCache.set(sourceFile, cache);
  }

  const dotIdx = calleeText.indexOf('.');
  const nsText = dotIdx > 0 ? calleeText.slice(0, dotIdx) : calleeText;
  const cached = cache.get(nsText);
  if (cached !== undefined) return cached;

  let result = false;
  try {
    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifierValue();

      const nsImport = importDecl.getNamespaceImport();
      if (nsImport?.getText() === nsText) {
        result = isEffectPackageSpecifier(specifier);
        break;
      }

      const defImport = importDecl.getDefaultImport();
      if (defImport?.getText() === nsText) {
        result = isEffectPackageSpecifier(specifier);
        break;
      }

      for (const named of importDecl.getNamedImports()) {
        const alias = named.getAliasNode()?.getText();
        const localName = alias ?? named.getName();
        if (localName === nsText) {
          if (isEffectPackageSpecifier(specifier)) {
            result = true;
          } else if (specifier.startsWith('.')) {
            const barrelFile = resolveBarrelSourceFile(
              sourceFile.getProject(), sourceFile.getFilePath(), specifier
            );
            if (barrelFile) {
              const reExported = getNamesReExportedFromEffect(barrelFile);
              if (reExported.has(named.getName())) {
                result = true;
              } else {
                // Multi-level: trace through barrel → barrel chains (up to 3 levels)
                result = traceReExportChain(barrelFile, named.getName(), sourceFile.getProject(), 3);
              }
            }
          }
          break;
        }
      }
      if (result) break;
    }
  } catch {
    result = false;
  }

  cache.set(nsText, result);
  return result;
}

/**
 * Resolve the module specifier for the namespace part of a property access (e.g. E in E.succeed).
 * Returns the import's module specifier string, or undefined if not found.
 */
function resolveNamespaceImportModuleSpecifier(
  expr: import('ts-morph').PropertyAccessExpression,
  sourceFile: SourceFile,
): string | undefined {
  const nsExpr = expr.getExpression();
  const nsText = nsExpr.getText();
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const nsImport = importDecl.getNamespaceImport();
    if (nsImport?.getText() === nsText) return specifier;
    const defImport = importDecl.getDefaultImport();
    if (defImport?.getText() === nsText) return specifier;
    for (const named of importDecl.getNamedImports()) {
      const alias = named.getAliasNode()?.getText();
      const localName = alias ?? named.getName();
      if (localName === nsText) return specifier;
    }
  }
  return undefined;
}

// =============================================================================
// Effect-like call detection
// =============================================================================

/**
 * Symbol/typechecker-backed check for Effect-like call. Fast path: API_PREFIXES + file alias set;
 * fallback: resolve callee namespace to module specifier and classify by origin.
 * Optional knownEffectInternalsRoot: local paths under that root are treated as Effect-like (improve.md §1).
 */
export function isEffectLikeCallExpression(
  call: CallExpression,
  sourceFile: SourceFile,
  effectAliases: Set<string>,
  knownEffectInternalsRoot?: string,
): boolean {
  const expr = call.getExpression();
  const text = expr.getText();
  if (API_PREFIXES.some((p) => text.startsWith(p)) || text.startsWith('pipe(')) return true;
  for (const alias of effectAliases) {
    if (text.startsWith(`${alias}.`)) return true;
  }
  const { SyntaxKind } = loadTsMorph();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
  const propAccess = expr as PropertyAccessExpression;
  const specifier = resolveNamespaceImportModuleSpecifier(propAccess, sourceFile);
  if (!specifier) return false;
  if (isEffectPackageSpecifier(specifier)) return true;
  if (specifier.startsWith('.')) {
    const barrelFile = resolveBarrelSourceFile(
      sourceFile.getProject(),
      sourceFile.getFilePath(),
      specifier,
    );
    if (barrelFile) {
      const reExported = getNamesReExportedFromEffect(barrelFile);
      const nsText = propAccess.getExpression().getText();
      for (const importDecl of sourceFile.getImportDeclarations()) {
        if (importDecl.getModuleSpecifierValue() !== specifier) continue;
        for (const named of importDecl.getNamedImports()) {
          const localName = named.getAliasNode()?.getText() ?? named.getName();
          if (localName === nsText && reExported.has(named.getName())) return true;
        }
      }
    }
    if (
      isSpecifierUnderKnownEffectInternalsRoot(
        sourceFile.getFilePath(),
        specifier,
        knownEffectInternalsRoot,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if callee text is an Effect API call (prefix, alias, or symbol-resolved).
 */
export function isEffectCallee(
  text: string,
  effectAliases?: Set<string>,
  sourceFile?: SourceFile,
): boolean {
  if (API_PREFIXES.some((prefix) => text.startsWith(prefix)) || text.startsWith('pipe(')) {
    return true;
  }
  if (effectAliases) {
    for (const alias of effectAliases) {
      if (text.startsWith(`${alias}.`)) return true;
    }
  }
  if (sourceFile && text.includes('.')) {
    return resolveCalleeModuleOrigin(text, sourceFile);
  }
  return false;
}
