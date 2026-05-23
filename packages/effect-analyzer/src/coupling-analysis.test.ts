import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import './register-node-ts-morph';
import { analyzeCoupling, renderCouplingReport } from './coupling-analysis';
import { loadTsMorph } from './ts-morph-loader';

interface Fixture {
  root: string;
  write: (relPath: string, content: string) => string;
  files: () => string[];
}

const createFixture = (prefix: string): Fixture => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const all: string[] = [];
  return {
    root,
    files: () => all,
    write: (relPath, content) => {
      const abs = join(root, relPath);
      const dir = abs.slice(0, abs.lastIndexOf('/'));
      if (dir && dir !== root) mkdirSync(dir, { recursive: true });
      writeFileSync(abs, content);
      all.push(abs);
      return abs;
    },
  };
};

const findMetric = (
  analysis: ReturnType<typeof analyzeCoupling>,
  projectFilePath: string,
) => analysis.metrics.find((m) => m.projectFilePath === projectFilePath);

describe('coupling-analysis', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture('coupling-analysis-');
  });

  afterEach(() => {
    rmSync(fixture.root, { recursive: true, force: true });
  });

  describe('import parsing (AST)', () => {
    it('counts side-effect imports', () => {
      fixture.write('side-effect.ts', `import './target';\n`);
      fixture.write('target.ts', `export const x = 1;\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 1,
      });
      const target = findMetric(a, 'target.ts');
      expect(target?.fanIn).toBe(1);
      expect(findMetric(a, 'side-effect.ts')?.fanOut).toBe(1);
    });

    it('counts dynamic import() calls', () => {
      fixture.write(
        'dyn.ts',
        `export async function load() {\n  return import('./target');\n}\n`,
      );
      fixture.write('target.ts', `export const x = 1;\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'dyn.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'target.ts')?.fanIn).toBe(1);
    });

    it('counts re-exports', () => {
      fixture.write('reexport.ts', `export { x } from './target';\n`);
      fixture.write('target.ts', `export const x = 1;\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'reexport.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'target.ts')?.fanIn).toBe(1);
    });

    it('resolves Node ESM .js imports to .ts source files', () => {
      // ESM convention: TypeScript code imports compiled output `import '../foo.js'`
      // even though the on-disk source is `../foo.ts`. The resolver should map it back.
      fixture.write('consumer.ts', `import { x } from './target.js';\nconsole.log(x);\n`);
      fixture.write('target.ts', `export const x = 1;\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'target.ts')?.fanIn).toBe(1);
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
    });

    it('resolves .jsx imports to .tsx source files', () => {
      fixture.write('view.tsx', `export const View = () => null;\n`);
      fixture.write(
        'consumer.tsx',
        `import { View } from './view.jsx';\nexport default View;\n`,
      );

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'view.tsx')?.fanIn).toBe(1);
    });

    it('ignores external npm imports', () => {
      fixture.write(
        'consumer.ts',
        `import { Effect } from 'effect';\nimport * as path from 'node:path';\nconsole.log(Effect, path);\n`,
      );

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(0);
    });

    it('deduplicates multiple imports of the same target', () => {
      fixture.write(
        'consumer.ts',
        `import { a } from './target';\nimport type { B } from './target';\nexport { c } from './target';\n`,
      );
      fixture.write(
        'target.ts',
        `export const a = 1;\nexport type B = number;\nexport const c = 3;\n`,
      );

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'target.ts')?.fanIn).toBe(1);
    });
  });

  describe('known-hub annotations', () => {
    const makeImporters = (n: number, targetRel: string) => {
      for (let i = 0; i < n; i++) {
        fixture.write(
          `importer-${i}.ts`,
          `import './${targetRel.replace(/\.ts$/, '')}';\n`,
        );
      }
    };

    it('suppresses high-fanin issue when annotated via // effect-analyzer-known-hub', () => {
      fixture.write(
        'hub.ts',
        `// effect-analyzer-known-hub central registry\nexport const x = 1;\n`,
      );
      makeImporters(6, 'hub.ts');

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 100,
      });
      const hub = findMetric(a, 'hub.ts');
      expect(hub?.knownHub).toBe(true);
      expect(hub?.knownHubReason).toBe('central registry');
      expect(a.issues.find((i) => i.projectFilePath === 'hub.ts' && i.type === 'high-fanin')).toBeUndefined();
    });

    it('suppresses high-fanin issue when annotated via @known-hub JSDoc tag', () => {
      fixture.write(
        'hub.ts',
        `/**\n * Central registry.\n *\n * @known-hub imported by all consumers\n */\nexport const x = 1;\n`,
      );
      makeImporters(6, 'hub.ts');

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 100,
      });
      const hub = findMetric(a, 'hub.ts');
      expect(hub?.knownHub).toBe(true);
      expect(hub?.knownHubReason).toBe('imported by all consumers');
      expect(a.issues.find((i) => i.projectFilePath === 'hub.ts' && i.type === 'high-fanin')).toBeUndefined();
    });

    it('flags unannotated hub above high-fanin threshold', () => {
      fixture.write('hub.ts', `export const x = 1;\n`);
      makeImporters(6, 'hub.ts');

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 100,
      });
      const issue = a.issues.find((i) => i.projectFilePath === 'hub.ts');
      expect(issue?.type).toBe('high-fanin');
      expect(issue?.knownHub).toBe(false);
      expect(a.summary.unannotatedHubs).toBe(1);
    });

    it('still reports critical fan-in for known hubs (as low-impact monitoring)', () => {
      fixture.write(
        'hub.ts',
        `// effect-analyzer-known-hub central\nexport const x = 1;\n`,
      );
      makeImporters(8, 'hub.ts');

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 8,
      });
      const issue = a.issues.find((i) => i.projectFilePath === 'hub.ts');
      expect(issue?.type).toBe('critical-fanin');
      expect(issue?.knownHub).toBe(true);
      expect(issue?.estimatedImpact).toBe('low');
      expect(a.summary.criticalFanInFiles).toBe(0);
      expect(a.summary.unannotatedHubs).toBe(0);
    });

    it('detects annotation after a shebang/license header (full leading comment block)', () => {
      fixture.write(
        'hub.ts',
        [
          '// Copyright (c) 2026',
          '// SPDX-License-Identifier: MIT',
          '',
          '/**',
          ' * Big preamble that pushes us past 10 lines.',
          ' * Line 2',
          ' * Line 3',
          ' * Line 4',
          ' * Line 5',
          ' * Line 6',
          ' * Line 7',
          ' * Line 8',
          ' *',
          ' * @known-hub central registry',
          ' */',
          'export const x = 1;',
          '',
        ].join('\n'),
      );
      makeImporters(6, 'hub.ts');

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 100,
      });
      expect(findMetric(a, 'hub.ts')?.knownHub).toBe(true);
    });
  });

  describe('fan-out thresholds', () => {
    it('flags high-fanout regardless of fan-in', () => {
      const targets: string[] = [];
      for (let i = 0; i < 5; i++) {
        const name = `t-${i}.ts`;
        targets.push(`./t-${i}`);
        fixture.write(name, `export const v${i} = ${i};\n`);
      }
      fixture.write(
        'consumer.ts',
        targets.map((t) => `import '${t}';`).join('\n') + '\n',
      );

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanOutThreshold: 5,
      });
      const issue = a.issues.find((i) => i.projectFilePath === 'consumer.ts');
      expect(issue?.type).toBe('high-fanout');
      expect(issue?.value).toBe(5);
    });
  });

  describe('knownHubPaths option', () => {
    it('marks listed paths as known hubs without requiring a comment', () => {
      const hubPath = fixture.write('hub.ts', `export const x = 1;\n`);
      for (let i = 0; i < 6; i++) {
        fixture.write(`importer-${i}.ts`, `import './hub';\n`);
      }

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
        criticalFanInThreshold: 100,
        knownHubPaths: [hubPath],
      });

      const hub = findMetric(a, 'hub.ts');
      expect(hub?.knownHub).toBe(true);
      expect(hub?.knownHubReason).toBe('configured hub');
      expect(a.summary.knownHubs).toBe(1);
      expect(a.issues.find((i) => i.projectFilePath === 'hub.ts' && i.type === 'high-fanin')).toBeUndefined();
    });

    it('prefers comment reason over "configured hub" when both apply', () => {
      const hubPath = fixture.write(
        'hub.ts',
        `// effect-analyzer-known-hub explicit reason\nexport const x = 1;\n`,
      );
      fixture.write('importer.ts', `import './hub';\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        knownHubPaths: [hubPath],
      });
      expect(findMetric(a, 'hub.ts')?.knownHubReason).toBe('explicit reason');
    });
  });

  describe('prebuilt Project (in-memory)', () => {
    it('analyzes files from an in-memory ts-morph Project without touching disk', () => {
      const { Project } = loadTsMorph();
      const project = new Project({ useInMemoryFileSystem: true });
      const root = '/virtual';
      const hubPath = `${root}/hub.ts`;
      const consumerPath = `${root}/consumer.ts`;

      project.createSourceFile(
        hubPath,
        `/**\n * @known-hub virtual central\n */\nexport const x = 1;\n`,
      );
      project.createSourceFile(consumerPath, `import { x } from './hub';\nconsole.log(x);\n`);

      const a = analyzeCoupling([hubPath, consumerPath], root, { project });
      const hub = findMetric(a, 'hub.ts');
      expect(hub).toBeDefined();
      expect(hub?.fanIn).toBe(1);
      expect(hub?.knownHub).toBe(true);
      expect(hub?.knownHubReason).toBe('virtual central');
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
    });
  });

  describe('tsconfig path aliases', () => {
    it('resolves @/* path alias via tsconfig', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
      }));
      const srcDir = join(fixture.root, 'src');
      mkdirSync(srcDir, { recursive: true });
      fixture.write('src/target.ts', `export const x = 1;\n`);
      fixture.write('consumer.ts', `import { x } from '@/target';\nconsole.log(x);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'src/target.ts')?.fanIn).toBe(1);
    });

    it('resolves ~/* alias with wildcard subpath', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '~/*': ['./lib/*'] },
        },
      }));
      const libDir = join(fixture.root, 'lib');
      mkdirSync(libDir, { recursive: true });
      fixture.write('lib/util/helper.ts', `export const help = () => {};\n`);
      fixture.write('app.ts', `import { help } from '~/util/helper';\nhelp();\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
      });
      expect(findMetric(a, 'app.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'lib/util/helper.ts')?.fanIn).toBe(1);
    });

    it('resolves exact prefix match without wildcard', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@lib': ['./src/lib/index.ts'] },
        },
      }));
      const srcDir = join(fixture.root, 'src', 'lib');
      mkdirSync(srcDir, { recursive: true });
      fixture.write('src/lib/index.ts', `export const lib = 42;\n`);
      fixture.write('consumer.ts', `import { lib } from '@lib';\nconsole.log(lib);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
        highFanInThreshold: 1,
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'src/lib/index.ts')?.fanIn).toBe(1);
    });

    it('skips external imports even when tsconfig is provided', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
      }));
      fixture.write('consumer.ts', `import { Effect } from 'effect';\nimport { x } from './local';\n`);
      fixture.write('local.ts', `export const x = 1;\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
    });

    it('longest-prefix-wins when multiple aliases match', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['./lib/generic/*'],
            '@app/*': ['./src/app/*'],
          },
        },
      }));
      const appDir = join(fixture.root, 'src', 'app');
      mkdirSync(appDir, { recursive: true });
      fixture.write('src/app/feature.ts', `export const feature = true;\n`);
      fixture.write('consumer.ts', `import { feature } from '@app/feature';\nconsole.log(feature);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'src/app/feature.ts')?.fanIn).toBe(1);
    });

    it('falls through to relative resolution when alias does not match', () => {
      fixture.write('tsconfig.json', JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
      }));
      fixture.write('local.ts', `export const local = true;\n`);
      fixture.write('consumer.ts', `import { local } from './local';\nconsole.log(local);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        tsconfig: join(fixture.root, 'tsconfig.json'),
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'local.ts')?.fanIn).toBe(1);
    });
  });

  describe('workspace packages', () => {
    it('resolves workspace package name imports', () => {
      fixture.write('packages/foo/src/index.ts', `export const foo = 1;\n`);
      fixture.write('packages/bar/src/consumer.ts', `import { foo } from '@org/foo';\nconsole.log(foo);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        workspacePackages: {
          '@org/foo': join(fixture.root, 'packages', 'foo', 'src'),
        },
      });
      expect(findMetric(a, 'packages/bar/src/consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'packages/foo/src/index.ts')?.fanIn).toBe(1);
    });

    it('resolves workspace package subpath imports', () => {
      const pkgDir = join(fixture.root, 'packages', 'utils', 'src');
      mkdirSync(join(pkgDir, 'helpers'), { recursive: true });
      fixture.write('packages/utils/src/helpers/parse.ts', `export const parse = (s: string) => s;\n`);
      fixture.write('consumer.ts', `import { parse } from '@org/utils/helpers/parse';\nparse('x');\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        workspacePackages: {
          '@org/utils': join(fixture.root, 'packages', 'utils', 'src'),
        },
      });
      expect(findMetric(a, 'consumer.ts')?.fanOut).toBe(1);
      expect(findMetric(a, 'packages/utils/src/helpers/parse.ts')?.fanIn).toBe(1);
    });
  });

  describe('transitive fan-in', () => {
    it('propagates fan-in through re-export chain with transitive option', () => {
      fixture.write('internal.ts', `export const helper = () => {};\n`);
      fixture.write('barrel.ts', `export { helper } from './internal';\n`);
      fixture.write('consumer.ts', `import { helper } from './barrel';\nhelper();\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 1,
        transitive: true,
      });

      // barrel has fan-in 1 (from consumer)
      expect(findMetric(a, 'barrel.ts')?.fanIn).toBe(1);
      // internal gets transitive fan-in from consumer via barrel
      expect(findMetric(a, 'internal.ts')?.fanIn).toBe(2);
    });

    it('handles multi-level re-export chains', () => {
      fixture.write('core.ts', `export const core = () => {};\n`);
      fixture.write('middle.ts', `export { core } from './core';\n`);
      fixture.write('barrel.ts', `export { core } from './middle';\n`);
      fixture.write('consumer.ts', `import { core } from './barrel';\ncore();\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 1,
        transitive: true,
      });

      expect(findMetric(a, 'barrel.ts')?.fanIn).toBe(1);
      expect(findMetric(a, 'middle.ts')?.fanIn).toBe(2);
      expect(findMetric(a, 'core.ts')?.fanIn).toBe(3);
    });

    it('default fan-in (non-transitive) does not propagate', () => {
      fixture.write('internal.ts', `export const helper = () => {};\n`);
      fixture.write('barrel.ts', `export { helper } from './internal';\n`);
      fixture.write('consumer.ts', `import { helper } from './barrel';\nhelper();\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 1,
      });

      expect(findMetric(a, 'barrel.ts')?.fanIn).toBe(1);
      expect(findMetric(a, 'internal.ts')?.fanIn).toBe(1);
    });
  });

  describe('parse failures tracking', () => {
    it('reports parse failures in summary', () => {
      // Create a file ts-morph cannot add (binary-looking content in .ts extension)
      fixture.write('valid.ts', `export const x = 1;\n`);
      const brokenPath = fixture.write('broken.ts', `\0INVALID\0BINARY\0\n`);
      // Make it unreadable by clearing permissions
      try { rmSync(brokenPath); } catch { /* ignore */ }

      fixture.write('consumer.ts', `import { x } from './valid';\nconsole.log(x);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root);
      expect(a.summary.parseFailures).toBeGreaterThanOrEqual(1);
    });
  });

  describe('knownHubs summary filtering', () => {
    it('does not count annotated files below fan-in threshold in knownHubs count', () => {
      fixture.write(
        'hub.ts',
        `// effect-analyzer-known-hub small module\nexport const x = 1;\n`,
      );
      fixture.write('consumer.ts', `import { x } from './hub';\nconsole.log(x);\n`);

      const a = analyzeCoupling(fixture.files(), fixture.root, {
        highFanInThreshold: 5,
      });
      // hub has fan-in 1 < threshold 5, so not counted as a hub at scale
      expect(a.summary.knownHubs).toBe(0);
      // but it's still returned in the knownHubs list
      expect(a.knownHubs.length).toBe(1);
    });
  });

  describe('renderer updates', () => {
    it('includes --format json hint in truncation message', () => {
      const metrics: import('./coupling-analysis').FileCouplingMetrics[] = [];
      for (let i = 0; i < 35; i++) {
        metrics.push({
          filePath: `/path/file-${i}.ts`,
          projectFilePath: `file-${i}.ts`,
          fanIn: i,
          fanOut: 0,
          knownHub: false,
          knownHubReason: '',
          importSources: [],
          importedBy: [],
        });
      }

      const analysis = {
        metrics,
        issues: [],
        summary: {
          totalFiles: 35,
          analyzedFiles: 35,
          highFanInFiles: 0,
          criticalFanInFiles: 0,
          highFanOutFiles: 0,
          knownHubs: 0,
          unannotatedHubs: 0,
          parseFailures: 0,
        },
        knownHubs: [],
      };

      const report = renderCouplingReport(analysis);
      expect(report).toContain('--format json');
    });
  });
});
