import { describe, it, expect } from 'vitest';
import { extractJSDocTags } from './analysis-utils';
import { loadTsMorph } from './ts-morph-loader';

function parseNode(source: string) {
  const { Project } = loadTsMorph();
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('test.ts', source);
  return sf.getVariableDeclarations()[0]!;
}

describe('extractJSDocTags', () => {
  it('extracts @param tags', () => {
    const node = parseNode(`
      /**
       * Does something
       * @param name - The user name
       * @param age - The user age
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.params).toEqual([
      { name: 'name', description: 'The user name' },
      { name: 'age', description: 'The user age' },
    ]);
  });

  it('extracts @returns tag', () => {
    const node = parseNode(`
      /**
       * @returns The result value
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.returns).toBe('The result value');
  });

  it('extracts @throws tags', () => {
    const node = parseNode(`
      /**
       * @throws ValidationError when input is invalid
       * @throws NetworkError on connection failure
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.throws).toEqual([
      'ValidationError when input is invalid',
      'NetworkError on connection failure',
    ]);
  });

  it('extracts @example tag', () => {
    const node = parseNode(`
      /**
       * @example doSomething("hello")
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.example).toBe('doSomething("hello")');
  });

  it('returns undefined when no JSDoc tags present', () => {
    const node = parseNode(`const x = 1;`);
    const tags = extractJSDocTags(node);
    expect(tags).toBeUndefined();
  });

  it('returns undefined when only description (no tags)', () => {
    const node = parseNode(`
      /** Just a description */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags).toBeUndefined();
  });

  it('handles @param without description', () => {
    const node = parseNode(`
      /**
       * @param name
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.params).toEqual([{ name: 'name' }]);
  });

  it('handles @return alias for @returns', () => {
    const node = parseNode(`
      /**
       * @return The value
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.returns).toBe('The value');
  });

  it('handles @exception alias for @throws', () => {
    const node = parseNode(`
      /**
       * @exception SomeError
       */
      const x = 1;
    `);
    const tags = extractJSDocTags(node);
    expect(tags?.throws).toEqual(['SomeError']);
  });
});
