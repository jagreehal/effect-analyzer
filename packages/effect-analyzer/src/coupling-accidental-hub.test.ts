/**
 * Item 8 from ___temp/coupling-analyzer-improvement-notes.md.
 *
 * High fan-in and high fan-out were reported as two independent issues, so the
 * file that scores on both — the strongest rewrite candidate a coupling report
 * can surface — read as two ordinary warnings among many. A module that many
 * files depend on AND that reaches broadly into the codebase is not a stable
 * interface; it is a junction, and a change to anything it imports can reach
 * everything that imports it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import './register-node-ts-morph';
import { analyzeCoupling } from './coupling-analysis';

/**
 * `hub.ts` imports `leaf0..N` (fan-out) and is imported by `consumer0..N`
 * (fan-in), so it crosses both thresholds at once. `broad.ts` only imports,
 * and `popular.ts` is only imported, so each crosses exactly one.
 */
const WIDTH = 6;

const buildProject = (root: string): string[] => {
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    const abs = join(root, rel);
    mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    writeFileSync(abs, content);
    files.push(abs);
  };

  for (let i = 0; i < WIDTH; i++) {
    write(`src/leaf${i}.ts`, `export const leaf${i} = ${i};\n`);
  }

  const importLeaves = (name: string) =>
    Array.from(
      { length: WIDTH },
      (_, i) => `import { leaf${i} } from './leaf${i}';`,
    ).join('\n') +
    `\nexport const ${name} = [${Array.from({ length: WIDTH }, (_, i) => `leaf${i}`).join(', ')}];\n`;

  write('src/hub.ts', importLeaves('hub'));
  write('src/broad.ts', importLeaves('broad'));
  write('src/popular.ts', 'export const popular = 1;\n');

  for (let i = 0; i < WIDTH; i++) {
    write(
      `src/consumer${i}.ts`,
      `import { hub } from './hub';\n` +
        `import { popular } from './popular';\n` +
        `export const consumer${i} = [hub, popular];\n`,
    );
  }

  return files;
};

describe('accidental hubs', () => {
  let root: string;
  let filePaths: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'effect-analyze-accidental-hub-'));
    filePaths = buildProject(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const analyze = () =>
    analyzeCoupling(filePaths, root, {
      highFanInThreshold: 5,
      criticalFanInThreshold: 50,
      highFanOutThreshold: 5,
    });

  const issuesFor = (name: string) =>
    analyze().issues.filter((i) => i.projectFilePath.endsWith(name));

  it('reports the file that is high on both axes as one accidental hub', () => {
    const types = issuesFor('hub.ts').map((i) => i.type);
    expect(types).toContain('accidental-hub');
    // Replaces the two independent warnings rather than adding a third.
    expect(types).not.toContain('high-fanin');
    expect(types).not.toContain('high-fanout');
  });

  it('names both numbers, since either alone understates the problem', () => {
    const issue = issuesFor('hub.ts').find((i) => i.type === 'accidental-hub')!;
    expect(issue.description).toContain('6');
    expect(issue.estimatedImpact).toBe('high');
  });

  it('leaves a file that is high on only one axis alone', () => {
    expect(issuesFor('broad.ts').map((i) => i.type)).toEqual(['high-fanout']);
    expect(issuesFor('popular.ts').map((i) => i.type)).toEqual(['high-fanin']);
  });

  it('counts accidental hubs in the summary', () => {
    expect(analyze().summary.accidentalHubs).toBe(1);
  });

  it('respects a known-hub annotation, which is what it is for', () => {
    const hubPath = filePaths.find((p) => p.endsWith('hub.ts'))!;
    writeFileSync(
      hubPath,
      `// effect-analyzer-known-hub public barrel\n` +
        Array.from(
          { length: 6 },
          (_, i) => `import { leaf${i} } from './leaf${i}';`,
        ).join('\n') +
        `\nexport const hub = [${Array.from({ length: 6 }, (_, i) => `leaf${i}`).join(', ')}];\n`,
    );

    expect(issuesFor('hub.ts').map((i) => i.type)).not.toContain(
      'accidental-hub',
    );
    expect(analyze().summary.accidentalHubs).toBe(0);
  });
});
