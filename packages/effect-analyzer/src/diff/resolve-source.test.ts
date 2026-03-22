import { describe, it, expect } from 'vitest';
import { parseSourceArg } from './resolve-source';

describe('parseSourceArg', () => {
  it('treats Windows absolute paths as file paths, not git ref selectors', () => {
    expect(parseSourceArg('C:\\repo\\src\\program.ts')).toEqual({
      kind: 'file',
      filePath: 'C:\\repo\\src\\program.ts',
    });
  });
});
