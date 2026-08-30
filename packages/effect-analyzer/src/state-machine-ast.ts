/**
 * ts-morph helpers for reading `@typeonce/effect-machine` source.
 *
 * Generic AST plumbing only — unwrapping expressions, reading object literals,
 * and resolving whether an identifier is really the package's `Machine`. It
 * knows nothing about states, transitions, or coverage, so both the extractor
 * and the diagnostics scanner can sit on top of it.
 */

import {
  Node,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type ObjectLiteralExpression,
  type Project,
} from 'ts-morph';
import type { SourceLocation } from './types';

export type SourceFile = ReturnType<Project['createSourceFile']>;

/**
 * Strip `as const`, `satisfies`, parentheses, `!` and `<T>` assertions.
 *
 * The same rule the program walker uses, so a wrapper cannot be transparent in
 * one analyzer and opaque in the other. This copy also missed `!`.
 */
import { unwrapExpression as unwrap } from './analysis-utils';
export { unwrap };

/** Read a string-literal value (after unwrapping `as const`), or undefined. */
export function stringValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const u = unwrap(node);
  if (Node.isStringLiteral(u)) return u.getLiteralValue();
  if (Node.isNoSubstitutionTemplateLiteral(u)) return u.getLiteralText();
  return undefined;
}

export interface PropEntry {
  readonly name: string;
  /** `undefined` for a shorthand property (`{ Idle }`). */
  readonly value: Node | undefined;
}

/** Named properties of an object literal, shorthand included. */
export function propEntries(obj: ObjectLiteralExpression): PropEntry[] {
  const out: PropEntry[] = [];
  for (const prop of obj.getProperties()) {
    if (Node.isShorthandPropertyAssignment(prop)) {
      out.push({ name: prop.getName(), value: undefined });
      continue;
    }
    if (!Node.isPropertyAssignment(prop)) continue;
    const nameNode = prop.getNameNode();
    const name = Node.isStringLiteral(nameNode)
      ? nameNode.getLiteralValue()
      : Node.isIdentifier(nameNode)
        ? nameNode.getText()
        : undefined;
    if (name !== undefined) out.push({ name, value: prop.getInitializer() });
  }
  return out;
}

export function propValue(obj: ObjectLiteralExpression, name: string): Node | undefined {
  return obj.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
}

export function locOf(node: Node, filePath: string): SourceLocation {
  const sf = node.getSourceFile();
  const offset = node.getStart();
  const { line, column } = sf.getLineAndColumnAtPos(offset);
  return { filePath, line, column, offset };
}

export const join = (parent: string, child: string): string =>
  parent === '' ? child : `${parent}.${child}`;

export function isFunctionLike(node: Node): node is ArrowFunction | FunctionExpression {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

export function isEffectMachineBinding(name: string, sf: SourceFile): boolean {
  return sf.getImportDeclarations().some((declaration) => {
    if (declaration.getModuleSpecifierValue() !== '@typeonce/effect-machine') {
      return false;
    }
    return declaration.getNamedImports().some((namedImport) => {
      if (namedImport.getName() !== 'Machine') return false;
      return (namedImport.getAliasNode()?.getText() ?? 'Machine') === name;
    });
  });
}

export function isEffectMachineNamespace(name: string, sf: SourceFile): boolean {
  return sf.getImportDeclarations().some(
    (declaration) =>
      declaration.getModuleSpecifierValue() === '@typeonce/effect-machine' &&
      declaration.getNamespaceImport()?.getText() === name,
  );
}

/** A call to a method on the imported `Machine` namespace. */
export function isMachineCall(node: Node, name: string): node is CallExpression {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== name) {
    return false;
  }
  const owner = expr.getExpression();
  if (Node.isIdentifier(owner)) {
    return isEffectMachineBinding(owner.getText(), node.getSourceFile());
  }
  return (
    Node.isPropertyAccessExpression(owner) &&
    owner.getName() === 'Machine' &&
    Node.isIdentifier(owner.getExpression()) &&
    isEffectMachineNamespace(owner.getExpression().getText(), node.getSourceFile())
  );
}
