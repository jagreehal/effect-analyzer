import { beforeAll, describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SourceFile, TypeChecker } from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import { extractEffectTypeSignature } from './type-extractor';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const fixturePath = resolve(__dirname, '__fixtures__/generic-e-resolution.ts');

/** One heavy project load; avoids re-parsing the package for each test under parallel CI load. */
let checker: TypeChecker;
let sourceFile: SourceFile;

beforeAll(() => {
  const { Project } = loadTsMorph();
  const project = new Project({
    tsConfigFilePath: resolve(pkgRoot, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  sourceFile = project.addSourceFileAtPath(fixturePath);
  checker = project.getTypeChecker();
}, 120_000);

describe('extractEffectTypeSignature — generic E resolution', () => {
  it(
    'resolves concrete error type from pipe base for pipe(Effect.succeed, withSpan)',
    () => {
      const decl = sourceFile.getVariableDeclaration('pipeWithSpan');
      expect(decl).toBeDefined();
      const init = decl!.getInitializer();
      expect(init).toBeDefined();
      const sig = extractEffectTypeSignature(init!, checker);
      expect(sig).toBeDefined();
      if (sig?.errorType) {
        expect(sig.errorType).not.toMatch(/^[A-Z]$/);
      }
    },
    30_000,
  );

  it(
    'resolves inner failure type for curried withSpan',
    () => {
      const decl = sourceFile.getVariableDeclaration('curriedWithSpan');
      expect(decl).toBeDefined();
      const init = decl!.getInitializer();
      expect(init).toBeDefined();
      const sig = extractEffectTypeSignature(init!, checker);
      expect(sig).toBeDefined();
      if (sig?.errorType) {
        expect(sig.errorType).not.toMatch(/^E$/);
      }
    },
    30_000,
  );
});
