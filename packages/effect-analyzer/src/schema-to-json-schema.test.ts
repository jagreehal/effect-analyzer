import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { schemaToJsonSchema } from './schema-to-json-schema';

function extractSchema(source: string, schemaVar = 'MySchema') {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', source);
  const decl = sf.getVariableDeclaration(schemaVar);
  const init = decl?.getInitializer();
  if (!init) return undefined;
  return schemaToJsonSchema(init);
}

describe('schemaToJsonSchema', () => {
  it('converts Schema.String', () => {
    const result = extractSchema('const MySchema = Schema.String;');
    expect(result).toEqual({ type: 'string' });
  });

  it('converts Schema.Struct', () => {
    const result = extractSchema(`
const MySchema = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
});
`);
    expect(result).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'number' } },
      required: ['name', 'age'],
    });
  });

  it('converts Schema.Struct with optional', () => {
    const result = extractSchema(`
const MySchema = Schema.Struct({
  name: Schema.String,
  desc: Schema.optional(Schema.String),
});
`);
    expect(result?.properties).toHaveProperty('name');
    expect(result?.properties).toHaveProperty('desc');
    expect(result?.required).toEqual(['name']);
  });

  it('converts inline Schema.Struct', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      'test.ts',
      `
import { Schema } from "effect"
const x = Schema.Struct({ name: Schema.String });
`,
    );
    const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    const structCall = calls.find((c) => c.getText().includes('Schema.Struct'));
    if (!structCall) throw new Error('No Struct call');
    const result = schemaToJsonSchema(structCall);
    expect(result).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });

  it('keeps a struct an object when one of its fields is an array', () => {
    const result = extractSchema(`
import { Schema } from "effect"
const MySchema = Schema.Struct({
  name: Schema.String,
  tags: Schema.Array(Schema.String),
});
`);
    expect(result).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'tags'],
    });
  });

  it('keeps a union a union when one of its members is an array', () => {
    const result = extractSchema(`
import { Schema } from "effect"
const MySchema = Schema.Union(Schema.String, Schema.Array(Schema.Number));
`);
    expect(result).toMatchObject({
      oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }],
    });
  });
});

/**
 * One row per construct in the dispatch table. The table is the whole point of
 * the module, so every entry needs an example: a construct with no row silently
 * converts to `undefined`.
 */
const CONSTRUCTS: ReadonlyArray<readonly [expr: string, expected: unknown]> = [
  ['Schema.String', { type: 'string' }],
  ['Schema.Number', { type: 'number' }],
  ['Schema.Int', { type: 'number' }],
  ['Schema.Positive', { type: 'number' }],
  ['Schema.NonNegative', { type: 'number' }],
  ['Schema.Finite', { type: 'number' }],
  ['Schema.Boolean', { type: 'boolean' }],
  ['Schema.Null', { type: 'null' }],
  ['Schema.Date', { type: 'string', format: 'date-time' }],
  ['Schema.DateTimeUtc', { type: 'string', format: 'date-time' }],
  ['Schema.Instant', { type: 'string', format: 'date-time' }],
  ['Schema.Number()', { type: 'number' }],
  ['Schema.Int()', { type: 'number' }],
  ['Schema.Positive()', { type: 'number' }],
  ['Schema.NonNegative()', { type: 'number' }],
  ['Schema.Finite()', { type: 'number' }],
  ['Schema.Boolean()', { type: 'boolean' }],
  ['Schema.Null()', { type: 'null' }],
  ['Schema.Date()', { type: 'string', format: 'date-time' }],
  ['Schema.DateTimeUtc()', { type: 'string', format: 'date-time' }],
  ['Schema.Instant()', { type: 'string', format: 'date-time' }],
  ['Schema.Array(Schema.String)', { type: 'array', items: { type: 'string' } }],
  // No argument to read: an array of anything rather than a guess.
  ['Schema.Array()', { type: 'array', items: {} }],
  ['Schema.Tuple(Schema.String, Schema.Number)', {
    type: 'array',
    items: [{ type: 'string' }, { type: 'number' }],
  }],
  ['Schema.Record(Schema.String, Schema.Number)', {
    type: 'object',
    additionalProperties: { type: 'number' },
  }],
  ['Schema.Record(Schema.String)', { type: 'object', additionalProperties: true }],
  ['Schema.Literal("paid")', { type: 'string', enum: ['paid'] }],
  ["Schema.Literal('paid')", { type: 'string', enum: ['paid'] }],
  ['Schema.Literal(42)', { type: 'number', enum: [42] }],
  ['Schema.Literal(true)', { type: 'boolean', enum: [true] }],
  ['Schema.Literal(false)', { type: 'boolean', enum: [false] }],
  ['Schema.optional(Schema.String)', { type: 'string', nullable: true }],
  ['Schema.Union(Schema.String, Schema.Null)', {
    oneOf: [{ type: 'string' }, { type: 'null' }],
  }],
  ['Schema.Struct({})', { type: 'object', additionalProperties: false }],
  ['Schema.Struct()', { type: 'object' }],
  // The anchors on the literal regexes matter: without them a bare identifier
  // that merely ends in digits would read as a number.
  ['Schema.Literal("a b")', { type: 'string', enum: ['a b'] }],
  // Not an object literal, so there is nothing to read the properties from.
  ['Schema.Struct(fields)', { type: 'object' }],
];

/** Constructs the converter does not model, which must not be guessed at. */
const UNMODELLED: readonly string[] = [
  'Schema.Literal(Symbol())',
  'Schema.Literal()',
  'Schema.Union()',
  'Schema.optional()',
  'Schema.NonEmptyString',
  'Schema.BigInt(1n)',
  'Schema.Literal(x42)',
  'Schema.Literal(42n)',
];

describe('the construct table', () => {
  it.each(CONSTRUCTS)('converts %s', (expr, expected) => {
    expect(extractSchema(`const MySchema = ${expr};`)).toEqual(expected);
  });

  it.each(UNMODELLED)('returns undefined for %s rather than guessing', (expr) => {
    expect(extractSchema(`const MySchema = ${expr};`)).toBeUndefined();
  });

  it('drops members and items it cannot convert rather than emitting holes', () => {
    expect(extractSchema('const MySchema = Schema.Union(Schema.String, unknownThing);')).toEqual({
      oneOf: [{ type: 'string' }],
    });
    expect(extractSchema('const MySchema = Schema.Tuple(Schema.String, unknownThing);')).toEqual({
      type: 'array',
      items: [{ type: 'string' }],
    });
  });

  it('returns undefined for a union whose every member is unconvertible', () => {
    expect(extractSchema('const MySchema = Schema.Union(unknownThing);')).toBeUndefined();
  });

  it('dispatches on the callee, so a nested construct cannot capture its parent', () => {
    expect(extractSchema('const MySchema = Schema.Array(Schema.Struct({ a: Schema.String }));'))
      .toEqual({
        type: 'array',
        items: {
          type: 'object',
          properties: { a: { type: 'string' } },
          additionalProperties: false,
          required: ['a'],
        },
      });
  });
});

describe('chains and references', () => {
  it('looks through an annotation chain to the construct underneath', () => {
    expect(
      extractSchema('const MySchema = Schema.Array(Schema.String).annotations({ title: "Tags" });'),
    ).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('follows a reference to another schema in the same file', () => {
    expect(
      extractSchema(`
const Inner = Schema.Struct({ id: Schema.String });
const MySchema = Schema.Struct({ inner: Inner });
`),
    ).toMatchObject({ properties: { inner: { type: 'object' } } });
  });

  it('follows a reference across a relative import', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile('inner.ts', 'export const Inner = Schema.Struct({ id: Schema.String });');
    const sf = project.createSourceFile(
      'main.ts',
      'import { Inner } from "./inner";\nconst MySchema = Inner;',
    );
    const init = sf.getVariableDeclaration('MySchema')?.getInitializer();
    expect(schemaToJsonSchema(init!)).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
  });

  it('returns undefined for a node with no schema behind it', () => {
    expect(extractSchema('const MySchema = someUnknownThing;')).toBeUndefined();
    expect(extractSchema('const other = 1;\nconst MySchema = other;')).toBeUndefined();
  });

  it('reads a chain whose construct is not the outermost call', () => {
    expect(
      extractSchema('const MySchema = Schema.String.pipe(Schema.minLength(1));'),
    ).toEqual({ type: 'string' });
  });
});

describe('Schema.Struct fields', () => {
  it('treats a field piped through .optional as optional too', () => {
    const result = extractSchema(`
const MySchema = Schema.Struct({
  name: Schema.String,
  note: Schema.String.optional(),
});
`);
    expect(result?.required).toEqual(['name']);
  });

  it('skips shorthand and spread properties, which carry no field name to read', () => {
    const result = extractSchema(`
const name = Schema.String;
const MySchema = Schema.Struct({ name, ...rest, id: Schema.String });
`);
    expect(result).toMatchObject({ properties: { id: { type: 'string' } }, required: ['id'] });
  });

  it('leaves properties off entirely when no field converted', () => {
    const result = extractSchema('const MySchema = Schema.Struct({ a: unknownThing });');
    expect(result).toEqual({
      type: 'object',
      properties: undefined,
      additionalProperties: false,
      required: ['a'],
    });
  });
});
