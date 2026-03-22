import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { schemaToJsonSchema } from './schema-to-json-schema';

function extractSchema(source: string, schemaVar = 'MySchema') {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', source);
  const decl = sf.getVariableDeclaration(schemaVar);
  const init = decl?.getInitializer();
  if (!init) return undefined;
  return schemaToJsonSchema(init, sf, project);
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
    const result = schemaToJsonSchema(structCall, sf, project);
    expect(result).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });
});
