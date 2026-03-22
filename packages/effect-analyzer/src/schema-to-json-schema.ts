/**
 * Effect Schema AST → OpenAPI JSON Schema
 *
 * Walks Effect Schema expressions in the AST and produces OpenAPI-compatible
 * JSON Schema (no $schema, suitable for OpenAPI components.schemas).
 */

import {
  SyntaxKind,
  type SourceFile,
  type Node,
  type CallExpression,
  type ObjectLiteralExpression,
  type Project,
  type Identifier,
  type VariableDeclaration,
  type PropertyAssignment,
  type ImportSpecifier,
} from 'ts-morph';
import { resolveModulePath } from './alias-resolution';

export type JsonSchemaObject = Record<string, unknown>;

/**
 * Resolve a node (identifier or expression) to the Schema definition.
 * Handles: Schema.Struct(...), variable references, imported names.
 */
function resolveSchemaNode(
  node: Node,
  sf: SourceFile,
  project: Project,
): Node | undefined {
  const text = node.getText();
  // Direct Schema.* call
  if (text.includes('Schema.')) return node;
  // Identifier - resolve to declaration (handles local vars and imports)
  if (node.getKind() === SyntaxKind.Identifier) {
    const ident = node as Identifier;
    const symbol = ident.getSymbol();
    const aliased = symbol?.getAliasedSymbol() ?? symbol;
    const decls = aliased?.getDeclarations() ?? [];
    for (const decl of decls) {
      if (decl.getKind() === SyntaxKind.VariableDeclaration) {
        const init = (decl as VariableDeclaration).getInitializer();
        if (init?.getText().includes('Schema.')) return init;
      }
      if (decl.getKind() === SyntaxKind.ImportSpecifier) {
        const exportName = (decl as ImportSpecifier).getName();
        const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
        if (importDecl) {
          const spec = importDecl.getModuleSpecifierValue();
          const currentPath = sf.getFilePath();
          const resolvedPath = spec.startsWith('.') ? resolveModulePath(currentPath, spec) : undefined;
          const targetSf = resolvedPath ? project.getSourceFile(resolvedPath) : undefined;
          if (targetSf) {
            const expDecls = targetSf.getExportedDeclarations().get(exportName) ?? [];
            for (const ed of expDecls) {
              if (ed.getKind() === SyntaxKind.VariableDeclaration) {
                const init = (ed as VariableDeclaration).getInitializer();
                if (init?.getText().includes('Schema.')) return init;
              }
            }
          }
        }
      }
    }
    // Fallback: search in same file for const/export const
    const name = ident.getText();
    const vars = sf.getVariableDeclarations();
    for (const v of vars) {
      if (v.getName() === name) {
        const init = v.getInitializer();
        if (init?.getText().includes('Schema.')) return init;
      }
    }
  }
  return node.getText().includes('Schema.') ? node : undefined;
}

/**
 * Extract OpenAPI JSON Schema from an Effect Schema AST node.
 */
export function schemaToJsonSchema(
  node: Node,
  sf: SourceFile,
  project: Project,
  defs?: Map<string, JsonSchemaObject>,
): JsonSchemaObject | undefined {
  const resolved = resolveSchemaNode(node, sf, project);
  if (!resolved) return undefined;
  return walkSchema(resolved, sf, project, defs ?? new Map<string, JsonSchemaObject>());
}

function walkSchema(
  node: Node,
  sf: SourceFile,
  project: Project,
  defs: Map<string, JsonSchemaObject>,
): JsonSchemaObject | undefined {
  const text = node.getText();

  // Check composite types first (they contain primitive names)
  // Schema.Array
  if (text.includes('Schema.Array')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
      const args = call.getArguments();
      const itemSchema = args[0] ? walkSchema(args[0], sf, project, defs) : undefined;
      return {
        type: 'array',
        items: itemSchema ?? {},
      };
    }
  }

  // Schema.Struct
  if (text.includes('Schema.Struct')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (!call) return { type: 'object' };
    const args = call.getArguments();
    const objArg = args[0];
    if (objArg?.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      return { type: 'object' };
    }
    const obj = objArg as ObjectLiteralExpression;
    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];
    for (const prop of obj.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const pa = prop as PropertyAssignment;
      const name = (pa.getNameNode() as Identifier).getText();
      const init = pa.getInitializer();
      if (!init) continue;
      const propText = init.getText();
      const isOptional = propText.includes('Schema.optional') || propText.includes('.optional');
      if (!isOptional) required.push(name);
      const propSchema = walkSchema(init, sf, project, defs);
      if (propSchema) properties[name] = propSchema;
    }
    const result: JsonSchemaObject = {
      type: 'object',
      properties: Object.keys(properties).length ? properties : undefined,
      additionalProperties: false,
    };
    if (required.length) result.required = required;
    return result;
  }

  // Schema.Union
  if (text.includes('Schema.Union')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
      const args = call.getArguments();
      const oneOf = args
        .map((a) => walkSchema(a, sf, project, defs))
        .filter((s): s is JsonSchemaObject => s !== undefined);
      if (oneOf.length) return { oneOf };
    }
  }

  // Schema.optional
  if (text.includes('Schema.optional') || text.includes('.pipe(Schema.optional')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
      const args = call.getArguments();
      const inner = args[0] ? walkSchema(args[0], sf, project, defs) : undefined;
      if (inner) return { ...inner, nullable: true };
    }
  }

  // Schema.Record
  if (text.includes('Schema.Record')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
      const args = call.getArguments();
      const valueSchema = args[1] ? walkSchema(args[1], sf, project, defs) : undefined;
      return {
        type: 'object',
        additionalProperties: valueSchema ?? true,
      };
    }
  }

  // Schema.Tuple
  if (text.includes('Schema.Tuple')) {
    const call =
      node.getKind() === SyntaxKind.CallExpression
        ? (node as CallExpression)
        : node.getFirstDescendantByKind(SyntaxKind.CallExpression);
    if (call) {
      const args = call.getArguments();
      const items = args.map((a) => walkSchema(a, sf, project, defs)).filter(Boolean);
      return { type: 'array', items: items as JsonSchemaObject[] };
    }
  }

  // Schema.DateFromString, Schema.DateTimeUtc, etc.
  if (
    text.includes('Schema.Date') ||
    text.includes('Schema.DateTimeUtc') ||
    text.includes('Schema.Instant')
  ) {
    return { type: 'string', format: 'date-time' };
  }

  // Primitives (check after composites)
  if (text.includes('Schema.String') && !text.includes('Schema.Struct')) {
    return { type: 'string' };
  }
  if (
    text.includes('Schema.Number') ||
    text.includes('Schema.Int') ||
    text.includes('Schema.Positive') ||
    text.includes('Schema.NonNegative') ||
    text.includes('Schema.Finite')
  ) {
    return { type: 'number' };
  }
  if (text.includes('Schema.Boolean')) return { type: 'boolean' };
  if (text.includes('Schema.Null')) return { type: 'null' };
  const literalMatch = /Schema\.Literal\s*\(\s*(["'])([^"']*)\1\s*\)/.exec(text);
  if (literalMatch) return { type: 'string', enum: [literalMatch[2]] };
  const literalNumMatch = /Schema\.Literal\s*\(\s*(\d+)\s*\)/.exec(text);
  if (literalNumMatch) return { type: 'number', enum: [Number(literalNumMatch[1])] };
  const literalBoolMatch = /Schema\.Literal\s*\(\s*(true|false)\s*\)/.exec(text);
  if (literalBoolMatch) return { type: 'boolean', enum: [literalBoolMatch[1] === 'true'] };

  // Variable reference - already resolved by resolveSchemaNode, recurse
  if (node.getKind() === SyntaxKind.Identifier) {
    const symbol = (node as Identifier).getSymbol();
    const decl = symbol?.getDeclarations()[0];
    const init = (decl as VariableDeclaration).getInitializer();
    if (init) return walkSchema(init, sf, project, defs);
  }

  return undefined;
}
