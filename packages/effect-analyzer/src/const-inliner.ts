/**
 * Const Inliner
 *
 * Resolves same-module const references for static analysis.
 * Handles patterns like:
 *   const myErrors = tags('A', 'B');
 *   await step('x', fn, { errors: myErrors });
 *
 * This is used by the analyzer to inline const values for full static extraction.
 */

import { loadTsMorph } from "./ts-morph-loader";
import { VariableDeclarationKind, type Node, type SourceFile } from "ts-morph";

// =============================================================================
// Types
// =============================================================================

/**
 * Result of resolving a const reference.
 */
export interface ConstResolution {
  /** Whether the resolution was successful */
  resolved: boolean;
  /** The resolved value (if successful) */
  value?: ConstValue;
  /** Reason for failure (if not resolved) */
  reason?: string;
}

/**
 * A resolved const value.
 */
export type ConstValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "array"; value: ConstValue[] }
  | { type: "object"; value: Record<string, ConstValue> }
  | { type: "null"; value: null }
  | { type: "undefined"; value: undefined };

/**
 * Cache for resolved const declarations in a source file.
 */
export interface ConstCache {
  /** Map of variable name to its resolved value */
  values: Map<string, ConstResolution>;
  /** Source file this cache is for */
  sourceFile: SourceFile;
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Create a const cache for a source file.
 */
export function createConstCache(sourceFile: SourceFile): ConstCache {
  return {
    values: new Map(),
    sourceFile,
  };
}

/**
 * Resolve a const reference by name.
 */
export function resolveConst(
  name: string,
  cache: ConstCache
): ConstResolution {
  // Check cache first
  const cached = cache.values.get(name);
  if (cached !== undefined) {
    return cached;
  }

  // Find the variable declaration
  const sourceFile = cache.sourceFile;

  // Look for variable declarations
  const variableDeclarations = sourceFile.getVariableDeclarations();

  for (const decl of variableDeclarations) {
    if (decl.getName() === name) {
      // Guard against cyclic references: mark as resolving before descending
      const sentinel: ConstResolution = {
        resolved: false,
        reason: `Cyclic reference detected for "${name}"`,
      };
      cache.values.set(name, sentinel);

      // Check if it's a const
      const statement = decl.getVariableStatement();
      if (statement?.getDeclarationKind() !== VariableDeclarationKind.Const) {
        const result: ConstResolution = {
          resolved: false,
          reason: `"${name}" is not a const declaration`,
        };
        cache.values.set(name, result);
        return result;
      }

      // Get the initializer
      const initializer = decl.getInitializer();
      if (!initializer) {
        const result: ConstResolution = {
          resolved: false,
          reason: `"${name}" has no initializer`,
        };
        cache.values.set(name, result);
        return result;
      }

      // Try to resolve the value
      const result = resolveNode(initializer, cache);
      cache.values.set(name, result);
      return result;
    }
  }

  // Not found
  const result: ConstResolution = {
    resolved: false,
    reason: `"${name}" not found in current file`,
  };
  cache.values.set(name, result);
  return result;
}

/**
 * Resolve a node to a const value.
 */
export function resolveNode(node: Node, cache: ConstCache): ConstResolution {
  const { Node } = loadTsMorph();

  // String literal
  if (Node.isStringLiteral(node)) {
    return {
      resolved: true,
      value: { type: "string", value: node.getLiteralValue() },
    };
  }

  // Number literal
  if (Node.isNumericLiteral(node)) {
    return {
      resolved: true,
      value: { type: "number", value: node.getLiteralValue() },
    };
  }

  // Boolean literal
  if (Node.isTrueLiteral(node)) {
    return {
      resolved: true,
      value: { type: "boolean", value: true },
    };
  }
  if (Node.isFalseLiteral(node)) {
    return {
      resolved: true,
      value: { type: "boolean", value: false },
    };
  }

  // Null literal
  if (Node.isNullLiteral(node)) {
    return {
      resolved: true,
      value: { type: "null", value: null },
    };
  }

  // Array literal
  if (Node.isArrayLiteralExpression(node)) {
    const elements = node.getElements();
    const values: ConstValue[] = [];

    for (const element of elements) {
      // Skip spread elements - can't inline those
      if (Node.isSpreadElement(element)) {
        return {
          resolved: false,
          reason: "Array contains spread element",
        };
      }

      const elementResult = resolveNode(element, cache);
      if (!elementResult.resolved || !elementResult.value) {
        return {
          resolved: false,
          reason: `Could not resolve array element: ${elementResult.reason}`,
        };
      }
      values.push(elementResult.value);
    }

    return {
      resolved: true,
      value: { type: "array", value: values },
    };
  }

  // Object literal
  if (Node.isObjectLiteralExpression(node)) {
    const properties = node.getProperties();
    const obj: Record<string, ConstValue> = {};

    for (const prop of properties) {
      // Skip spread assignments
      if (Node.isSpreadAssignment(prop)) {
        return {
          resolved: false,
          reason: "Object contains spread assignment",
        };
      }

      // Skip shorthand/computed properties
      if (Node.isShorthandPropertyAssignment(prop)) {
        const name = prop.getName();
        const refResult = resolveConst(name, cache);
        if (!refResult.resolved || !refResult.value) {
          return {
            resolved: false,
            reason: `Could not resolve shorthand property "${name}"`,
          };
        }
        obj[name] = refResult.value;
        continue;
      }

      if (!Node.isPropertyAssignment(prop)) {
        return {
          resolved: false,
          reason: "Object contains unsupported property type",
        };
      }

      // Get property name
      const nameNode = prop.getNameNode();
      if (Node.isComputedPropertyName(nameNode)) {
        return {
          resolved: false,
          reason: "Object contains computed property name",
        };
      }

      const name = prop.getName();
      const initializer = prop.getInitializer();

      if (!initializer) {
        return {
          resolved: false,
          reason: `Property "${name}" has no initializer`,
        };
      }

      const valueResult = resolveNode(initializer, cache);
      if (!valueResult.resolved || !valueResult.value) {
        return {
          resolved: false,
          reason: `Could not resolve property "${name}": ${valueResult.reason}`,
        };
      }

      obj[name] = valueResult.value;
    }

    return {
      resolved: true,
      value: { type: "object", value: obj },
    };
  }

  // Identifier - reference to another const
  if (Node.isIdentifier(node)) {
    const name = node.getText();

    // Handle undefined
    if (name === "undefined") {
      return {
        resolved: true,
        value: { type: "undefined", value: undefined },
      };
    }

    return resolveConst(name, cache);
  }

  // Call expression - handle tags() and similar helpers
  if (Node.isCallExpression(node)) {
    const expression = node.getExpression();
    const callee = Node.isIdentifier(expression) ? expression.getText() : null;

    // Handle tags() / err() helper
    if (callee === "tags" || callee === "err") {
      const args = node.getArguments();
      const values: ConstValue[] = [];

      for (const arg of args) {
        const argResult = resolveNode(arg, cache);
        if (!argResult.resolved || !argResult.value) {
          return {
            resolved: false,
            reason: `Could not resolve ${callee}() argument: ${argResult.reason}`,
          };
        }
        values.push(argResult.value);
      }

      return {
        resolved: true,
        value: { type: "array", value: values },
      };
    }

    return {
      resolved: false,
      reason: `Cannot inline function call: ${callee ?? "unknown"}`,
    };
  }

  // Template literal without expressions
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return {
      resolved: true,
      value: { type: "string", value: node.getLiteralValue() },
    };
  }

  // Template literal with expressions - can't inline
  if (Node.isTemplateExpression(node)) {
    return {
      resolved: false,
      reason: "Cannot inline template literal with expressions",
    };
  }

  // As expression - unwrap
  if (Node.isAsExpression(node)) {
    return resolveNode(node.getExpression(), cache);
  }

  // Satisfies expression - unwrap
  if (Node.isSatisfiesExpression(node)) {
    return resolveNode(node.getExpression(), cache);
  }

  // Parenthesized expression - unwrap
  if (Node.isParenthesizedExpression(node)) {
    return resolveNode(node.getExpression(), cache);
  }

  return {
    resolved: false,
    reason: `Unsupported node type: ${node.getKindName()}`,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert a ConstValue to a plain JavaScript value.
 */
export function constValueToJS(value: ConstValue): unknown {
  switch (value.type) {
    case "string":
    case "number":
    case "boolean":
    case "null":
    case "undefined":
      return value.value;
    case "array":
      return value.value.map(constValueToJS);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value.value)) {
        obj[k] = constValueToJS(v);
      }
      return obj;
    }
  }
}

/**
 * Extract string array from a ConstValue.
 * Returns undefined if the value is not a string array.
 */
export function extractStringArray(value: ConstValue): string[] | undefined {
  if (value.type !== "array") {
    return undefined;
  }

  const strings: string[] = [];
  for (const item of value.value) {
    if (item.type !== "string") {
      return undefined;
    }
    strings.push(item.value);
  }

  return strings;
}

/**
 * Extract a string from a ConstValue.
 * Returns undefined if the value is not a string.
 */
export function extractString(value: ConstValue): string | undefined {
  if (value.type !== "string") {
    return undefined;
  }
  return value.value;
}
