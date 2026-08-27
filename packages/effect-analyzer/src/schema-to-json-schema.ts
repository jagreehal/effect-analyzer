/**
 * Effect Schema AST → OpenAPI JSON Schema
 *
 * Walks Effect Schema expressions in the AST and produces OpenAPI-compatible
 * JSON Schema (no $schema, suitable for OpenAPI components.schemas).
 */

import {
  SyntaxKind,
  type Node,
  type CallExpression,
  type ObjectLiteralExpression,
  type Identifier,
  type VariableDeclaration,
  type PropertyAssignment,
} from 'ts-morph';

export type JsonSchemaObject = Record<string, unknown>;

/**
 * Resolve a node to the Schema definition behind it: a `Schema.*` expression is
 * already one, an identifier is followed to its declaration — local or imported.
 */
function resolveSchemaNode(node: Node): Node | undefined {
  if (node.getText().includes('Schema.')) return node;
  if (node.getKind() !== SyntaxKind.Identifier) return undefined;

  // `getAliasedSymbol` follows an import through to the declaration it names,
  // so a local const and an imported one resolve the same way.
  const symbol = (node as Identifier).getSymbol();
  const aliased = symbol?.getAliasedSymbol() ?? symbol;
  for (const declaration of aliased?.getDeclarations() ?? []) {
    if (declaration.getKind() !== SyntaxKind.VariableDeclaration) continue;
    const init = (declaration as VariableDeclaration).getInitializer();
    if (init?.getText().includes('Schema.')) return init;
  }

  return undefined;
}

/**
 * Extract OpenAPI JSON Schema from an Effect Schema AST node.
 */
export function schemaToJsonSchema(node: Node): JsonSchemaObject | undefined {
  const resolved = resolveSchemaNode(node);
  if (!resolved) return undefined;
  return walkSchema(resolved);
}

/**
 * The name in a direct `Schema.<name>(...)` call.
 *
 * This is the whole reason the dispatch below is keyed on calls: matching
 * `node.getText().includes('Schema.Array')` also matches anything nested in the
 * arguments, so `Schema.Struct({ tags: Schema.Array(...) })` reads as an array.
 * Only the callee identifies the construct.
 */
function schemaCallName(node: Node): string | undefined {
  if (node.getKind() !== SyntaxKind.CallExpression) return undefined;
  const callee = (node as CallExpression).getExpression().getText();
  return /(?:^|\.)Schema\.([A-Za-z]+)$/.exec(callee)?.[1];
}

const NUMBER: JsonSchemaObject = { type: 'number' };
const DATE_TIME: JsonSchemaObject = { type: 'string', format: 'date-time' };

/**
 * One entry per `Schema.<name>(...)` construct. A name that is absent is a
 * construct this converter does not model — it yields `undefined` rather than
 * being guessed at from surrounding text.
 */
const CALL_CONSTRUCTS: Record<
  string,
  (call: CallExpression) => JsonSchemaObject | undefined
> = {
  Array: (call) => {
    const [items] = call.getArguments();
    return { type: 'array', items: (items && walkSchema(items)) ?? {} };
  },

  Struct: (call) => {
    const [objArg] = call.getArguments();
    if (objArg?.getKind() !== SyntaxKind.ObjectLiteralExpression) {
      return { type: 'object' };
    }
    const properties: Record<string, JsonSchemaObject> = {};
    const required: string[] = [];
    for (const prop of (objArg as ObjectLiteralExpression).getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const assignment = prop as PropertyAssignment;
      const name = (assignment.getNameNode() as Identifier).getText();
      const init = assignment.getInitializer();
      if (!init) continue;
      const initText = init.getText();
      if (!initText.includes('Schema.optional') && !initText.includes('.optional')) {
        required.push(name);
      }
      const propertySchema = walkSchema(init);
      if (propertySchema) properties[name] = propertySchema;
    }
    const result: JsonSchemaObject = {
      type: 'object',
      properties: Object.keys(properties).length ? properties : undefined,
      additionalProperties: false,
    };
    if (required.length) result.required = required;
    return result;
  },

  Union: (call) => {
    const oneOf = call
      .getArguments()
      .map((argument) => walkSchema(argument))
      .filter((schema): schema is JsonSchemaObject => schema !== undefined);
    return oneOf.length ? { oneOf } : undefined;
  },

  optional: (call) => {
    const [inner] = call.getArguments();
    const schema = inner ? walkSchema(inner) : undefined;
    return schema ? { ...schema, nullable: true } : undefined;
  },

  Record: (call) => {
    const value = call.getArguments()[1];
    return {
      type: 'object',
      additionalProperties: (value && walkSchema(value)) ?? true,
    };
  },

  Tuple: (call) => ({
    type: 'array',
    items: call
      .getArguments()
      .map((argument) => walkSchema(argument))
      .filter(Boolean),
  }),

  Literal: (call) => {
    const [literal] = call.getArguments();
    const text = literal?.getText() ?? '';
    const quoted = /^(["'])([\s\S]*)\1$/.exec(text);
    if (quoted) return { type: 'string', enum: [quoted[2]] };
    if (/^\d+$/.test(text)) return { type: 'number', enum: [Number(text)] };
    if (text === 'true' || text === 'false') {
      return { type: 'boolean', enum: [text === 'true'] };
    }
    return undefined;
  },

  Date: () => DATE_TIME,
  DateTimeUtc: () => DATE_TIME,
  Instant: () => DATE_TIME,
  Number: () => NUMBER,
  Int: () => NUMBER,
  Positive: () => NUMBER,
  NonNegative: () => NUMBER,
  Finite: () => NUMBER,
  Boolean: () => ({ type: 'boolean' }),
  Null: () => ({ type: 'null' }),
};

/**
 * A node that is not itself a `Schema.<name>(...)` call: a bare `Schema.String`,
 * an identifier, or a call chain like `Schema.Array(...).annotations({...})`.
 *
 * Reading the source text is only sound here, where no callee contradicts it.
 */
function walkNonCall(node: Node): JsonSchemaObject | undefined {
  // A chain wrapping a construct — find the construct and dispatch to it.
  for (const inner of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = schemaCallName(inner);
    const construct = name === undefined ? undefined : CALL_CONSTRUCTS[name];
    if (construct) return construct(inner);
  }

  const text = node.getText();
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
    return NUMBER;
  }
  if (text.includes('Schema.Boolean')) return { type: 'boolean' };
  if (text.includes('Schema.Null')) return { type: 'null' };
  if (text.includes('Schema.Date') || text.includes('Schema.Instant')) return DATE_TIME;

  // A variable reference `resolveSchemaNode` could not follow.
  if (node.getKind() === SyntaxKind.Identifier) {
    const declaration = (node as Identifier).getSymbol()?.getDeclarations()[0];
    const init = (declaration as VariableDeclaration | undefined)?.getInitializer();
    if (init) return walkSchema(init);
  }

  return undefined;
}

function walkSchema(node: Node): JsonSchemaObject | undefined {
  const name = schemaCallName(node);
  if (name === undefined) return walkNonCall(node);
  const construct = CALL_CONSTRUCTS[name];
  return construct ? construct(node as CallExpression) : undefined;
}
