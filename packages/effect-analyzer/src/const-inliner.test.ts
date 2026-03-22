import { describe, it, expect } from 'vitest';
import {
  createConstCache,
  resolveConst,
  constValueToJS,
  extractStringArray,
  extractString,
} from './const-inliner';
import { loadTsMorph } from './ts-morph-loader';

function makeSourceFile(source: string) {
  const { Project } = loadTsMorph();
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile('test.ts', source);
}

describe('const-inliner', () => {
  describe('resolveConst', () => {
    it('resolves string const', () => {
      const sf = makeSourceFile(`const name = "hello";`);
      const cache = createConstCache(sf);
      const result = resolveConst('name', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'string', value: 'hello' });
    });

    it('resolves number const', () => {
      const sf = makeSourceFile(`const count = 42;`);
      const cache = createConstCache(sf);
      const result = resolveConst('count', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'number', value: 42 });
    });

    it('resolves boolean const', () => {
      const sf = makeSourceFile(`const flag = true;`);
      const cache = createConstCache(sf);
      const result = resolveConst('flag', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'boolean', value: true });
    });

    it('resolves null const', () => {
      const sf = makeSourceFile(`const nothing = null;`);
      const cache = createConstCache(sf);
      const result = resolveConst('nothing', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'null', value: null });
    });

    it('resolves array of strings', () => {
      const sf = makeSourceFile(`const tags = ["a", "b", "c"];`);
      const cache = createConstCache(sf);
      const result = resolveConst('tags', cache);
      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual(['a', 'b', 'c']);
    });

    it('resolves object literal', () => {
      const sf = makeSourceFile(`const config = { name: "test", retries: 3 };`);
      const cache = createConstCache(sf);
      const result = resolveConst('config', cache);
      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual({ name: 'test', retries: 3 });
    });

    it('resolves const reference chain', () => {
      const sf = makeSourceFile(`
        const base = "hello";
        const alias = base;
      `);
      const cache = createConstCache(sf);
      const result = resolveConst('alias', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'string', value: 'hello' });
    });

    it('fails for let declarations', () => {
      const sf = makeSourceFile(`let name = "hello";`);
      const cache = createConstCache(sf);
      const result = resolveConst('name', cache);
      expect(result.resolved).toBe(false);
      expect(result.reason).toContain('not a const');
    });

    it('fails for missing variables', () => {
      const sf = makeSourceFile(`const x = 1;`);
      const cache = createConstCache(sf);
      const result = resolveConst('missing', cache);
      expect(result.resolved).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('unwraps as expression', () => {
      const sf = makeSourceFile(`const name = "hello" as string;`);
      const cache = createConstCache(sf);
      const result = resolveConst('name', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'string', value: 'hello' });
    });

    it('unwraps satisfies expression', () => {
      const sf = makeSourceFile(`const name = "hello" satisfies string;`);
      const cache = createConstCache(sf);
      const result = resolveConst('name', cache);
      expect(result.resolved).toBe(true);
      expect(result.value).toEqual({ type: 'string', value: 'hello' });
    });

    it('fails cleanly for cyclic const reference chains', () => {
      const sf = makeSourceFile(`
        const a = b;
        const b = a;
      `);
      const cache = createConstCache(sf);

      expect(() => resolveConst('a', cache)).not.toThrow();
      const result = resolveConst('a', cache);
      expect(result.resolved).toBe(false);
    });
  });

  describe('extractStringArray', () => {
    it('extracts string array from ConstValue', () => {
      const result = extractStringArray({
        type: 'array',
        value: [
          { type: 'string', value: 'a' },
          { type: 'string', value: 'b' },
        ],
      });
      expect(result).toEqual(['a', 'b']);
    });

    it('returns undefined for non-array', () => {
      expect(extractStringArray({ type: 'string', value: 'x' })).toBeUndefined();
    });

    it('returns undefined for mixed array', () => {
      const result = extractStringArray({
        type: 'array',
        value: [
          { type: 'string', value: 'a' },
          { type: 'number', value: 42 },
        ],
      });
      expect(result).toBeUndefined();
    });
  });

  describe('extractString', () => {
    it('extracts string value', () => {
      expect(extractString({ type: 'string', value: 'hello' })).toBe('hello');
    });

    it('returns undefined for non-string', () => {
      expect(extractString({ type: 'number', value: 42 })).toBeUndefined();
    });
  });
});
