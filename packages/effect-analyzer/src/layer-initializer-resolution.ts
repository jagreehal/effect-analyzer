/**
 * Resolve identifiers to their underlying Layer/Effect initializer call.
 *
 * When a pipe chain starts with a variable (e.g. `myLayer.pipe(Layer.provide(...))`)
 * we follow the variable's declaration — including cross-file imports and
 * default imports — back to the original `Layer.*` or `Effect.*` call so the
 * analyzer can classify what's actually being piped.
 *
 * Extracted from effect-analysis.ts as part of the strangler-fig cleanup.
 * Behaviour is preserved exactly.
 */

import type {
  CallExpression,
  Node,
  Identifier,
  ImportSpecifier,
  VariableDeclaration,
  VariableStatement,
} from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import {
  normalizeEffectCallee,
  resolveBarrelSourceFile,
  resolveModulePath,
} from './alias-resolution';

/** Return true if the call expression text (e.g. "Layer.succeed" or "L.succeed") is a Layer or Effect initializer. */
export function isLayerOrEffectInitializerCallee(initCall: CallExpression): boolean {
  const initText = initCall.getExpression().getText();
  const srcFile = initCall.getSourceFile();
  const normalized = normalizeEffectCallee(initText, srcFile);
  return (
    normalized.startsWith('Layer.') ||
    normalized.startsWith('Effect.') ||
    initText === 'pipe' ||
    initText.endsWith('.pipe')
  );
}

/**
 * Resolve a Layer initializer from a cross-file import by resolving the target module
 * and looking up the exported declaration. Used when symbol alias resolution doesn't
 * yield a VariableDeclaration (e.g. project created without tsconfig).
 */
function resolveLayerInitializerFromImport(
  ident: Identifier,
  importSpec: ImportSpecifier,
  isLayerInit: (call: CallExpression) => boolean,
): CallExpression | undefined {
  const { SyntaxKind } = loadTsMorph();
  const sourceFile = ident.getSourceFile();
  const project = sourceFile.getProject();
  const currentPath = sourceFile.getFilePath();
  const importDecl = importSpec.getImportDeclaration();
  const specifier = importDecl.getModuleSpecifierValue();
  if (!specifier?.startsWith('.')) return undefined;
  let targetFile = resolveBarrelSourceFile(project, currentPath, specifier);
  if (!targetFile) {
    const resolvedPath = resolveModulePath(currentPath, specifier);
    if (resolvedPath) {
      const added = project.addSourceFileAtPath(resolvedPath);
      if (added) targetFile = added;
    }
  }
  if (!targetFile) return undefined;
  // Ensure we use the project's instance so alias resolution sees the same file
  targetFile = project.getSourceFile(targetFile.getFilePath()) ?? targetFile;
  const tryDecl = (d: Node): CallExpression | undefined => {
    if (d.getKind() === SyntaxKind.VariableDeclaration) {
      const v = d as VariableDeclaration;
      const init = v.getInitializer();
      if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
        return init as CallExpression;
      }
    }
    if (d.getKind() === SyntaxKind.VariableStatement) {
      const list = (d as VariableStatement).getDeclarationList();
      for (const v of list.getDeclarations()) {
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
          return init as CallExpression;
        }
      }
    }
    return undefined;
  };
  const exportName = importSpec.getName();
  const exported = targetFile.getExportedDeclarations();
  const decls = exported.get(exportName) ?? [];
  for (const d of decls) {
    const init = tryDecl(d);
    if (init) return init;
  }
  const targetName = (importSpec as { getTargetName?: () => string }).getTargetName?.();
  if (targetName && targetName !== exportName) {
    for (const d of exported.get(targetName) ?? []) {
      const init = tryDecl(d);
      if (init) return init;
    }
  }
  // Fallback: scan all exports (key may differ from import name in some ts-morph versions)
  for (const [, declList] of exported) {
    for (const d of declList) {
      const init = tryDecl(d);
      if (init) return init;
    }
  }
  return undefined;
}

function resolveLayerInitializerFromDefaultImport(
  ident: Identifier,
  importDecl: { getModuleSpecifierValue: () => string },
  isLayerInit: (call: CallExpression) => boolean,
): CallExpression | undefined {
  const { SyntaxKind } = loadTsMorph();
  const sourceFile = ident.getSourceFile();
  const project = sourceFile.getProject();
  const currentPath = sourceFile.getFilePath();
  const specifier = importDecl.getModuleSpecifierValue();
  if (!specifier?.startsWith('.')) return undefined;
  let targetFile = resolveBarrelSourceFile(project, currentPath, specifier);
  if (!targetFile) {
    const resolvedPath = resolveModulePath(currentPath, specifier);
    if (resolvedPath) {
      const added = project.addSourceFileAtPath(resolvedPath);
      if (added) targetFile = added;
    }
  }
  if (!targetFile) return undefined;
  targetFile = project.getSourceFile(targetFile.getFilePath()) ?? targetFile;
  const tryDecl = (d: Node): CallExpression | undefined => {
    if (d.getKind() === SyntaxKind.VariableDeclaration) {
      const v = d as VariableDeclaration;
      const init = v.getInitializer();
      if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
        return init as CallExpression;
      }
    }
    if (d.getKind() === SyntaxKind.VariableStatement) {
      const list = (d as VariableStatement).getDeclarationList();
      for (const v of list.getDeclarations()) {
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression && isLayerInit(init as CallExpression)) {
          return init as CallExpression;
        }
      }
    }
    return undefined;
  };
  for (const d of targetFile.getDefaultExportSymbol()?.getDeclarations() ?? []) {
    const init = tryDecl(d);
    if (init) return init;
  }
  for (const d of targetFile.getExportedDeclarations().get('default') ?? []) {
    const init = tryDecl(d);
    if (init) return init;
  }
  return undefined;
}

/** If node is an Identifier bound to a variable whose initializer is a Layer.* call, return that initializer; else return node. (GAP: pipe-chain base variable + cross-file.) */
export function resolveIdentifierToLayerInitializer(node: Node): Node {
  const { SyntaxKind } = loadTsMorph();
  if (node.getKind() !== SyntaxKind.Identifier) return node;
  const ident = node as Identifier;
  const name = ident.getText();
  let sym = ident.getSymbol();
  let decl = sym?.getValueDeclaration();
  let importSpec: ImportSpecifier | undefined =
    decl?.getKind() === SyntaxKind.ImportSpecifier ? (decl as ImportSpecifier) : undefined;
  if (!importSpec && sym) {
    const fromDecls = sym.getDeclarations().find((d) => d.getKind() === SyntaxKind.ImportSpecifier);
    if (fromDecls) importSpec = fromDecls as ImportSpecifier;
  }
  if (!importSpec) {
    const sf = ident.getSourceFile();
    for (const id of sf.getImportDeclarations()) {
      const defaultImport = id.getDefaultImport()?.getText();
      if (defaultImport === name) {
        const fromDefault = resolveLayerInitializerFromDefaultImport(
          ident,
          id,
          isLayerOrEffectInitializerCallee,
        );
        if (fromDefault) return fromDefault;
      }
      const spec = id
        .getNamedImports()
        .find((n) => n.getName() === name || n.getAliasNode()?.getText() === name);
      if (spec) {
        importSpec = spec;
        break;
      }
    }
  }
  // Cross-file: when the binding is an import, resolve via the target module first so we get
  // a node in the target file (alias resolution for L->Layer needs that file's SourceFile).
  if (importSpec) {
    const fromImport = resolveLayerInitializerFromImport(
      ident,
      importSpec,
      isLayerOrEffectInitializerCallee,
    );
    if (fromImport) return fromImport;
    sym = sym?.getImmediatelyAliasedSymbol() ?? sym?.getAliasedSymbol();
    decl = sym?.getValueDeclaration();
  }
  // Also follow alias if valueDeclaration is an export specifier (re-export)
  if (decl?.getKind() === SyntaxKind.ExportSpecifier) {
    sym = sym?.getImmediatelyAliasedSymbol() ?? sym?.getAliasedSymbol();
    decl = sym?.getValueDeclaration();
  }
  // Fallback: search all declarations for a VariableDeclaration with Layer initializer (cross-module)
  if (sym && decl?.getKind() !== SyntaxKind.VariableDeclaration) {
    for (const d of sym.getDeclarations()) {
      if (d.getKind() === SyntaxKind.VariableDeclaration) {
        const v = d as VariableDeclaration;
        const init = v.getInitializer();
        if (init?.getKind() === SyntaxKind.CallExpression) {
          if (isLayerOrEffectInitializerCallee(init as CallExpression)) {
            return init;
          }
        }
      }
    }
  }
  if (decl?.getKind() === SyntaxKind.VariableDeclaration) {
    const vd = decl as VariableDeclaration;
    const init = vd.getInitializer();
    if (init?.getKind() === SyntaxKind.CallExpression) {
      if (isLayerOrEffectInitializerCallee(init as CallExpression)) {
        return init;
      }
    }
  }
  return node;
}
