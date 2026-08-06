/**
 * Two repo rules oxlint has no equivalent for, carried over from the ESLint
 * config that TypeScript 7 forced us off:
 *
 *   1. `local/no-inline-type-import` — ban `x as import('mod').Type`.
 *   2. `no-restricted-syntax` on ImportExpression — ban runtime `import()`.
 *
 * Rule 2 needs the AST: `typeof import('ts-morph')` and `import('./types').Foo`
 * in a type position are legal, only the runtime call form is banned. ts-morph
 * is already a dependency, so we reuse it rather than pull in a linter.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';

const SRC = new URL('../src', import.meta.url).pathname;

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__fixtures__' ? [] : walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });

const files = walk(SRC);
const violations = [];

// Rule 1 — same regex the ESLint rule used.
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/\bas\s+import\s*\(/.test(line)) {
        violations.push(
          `${file}:${i + 1}  no-inline-type-import: Use a named type import instead of inline 'as import(...)'.`,
        );
      }
    });
}

// Rule 2 — ImportExpression only; type-position import() is a different node.
const project = new Project({ skipAddingFilesFromTsConfig: true, skipFileDependencyResolution: true });
for (const file of files) {
  const sf = project.addSourceFileAtPath(file);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    violations.push(
      `${file}:${call.getStartLineNumber()}  no-dynamic-import: Do not use dynamic import(). Use a static top-level import instead.`,
    );
  }
  project.removeSourceFile(sf);
}

if (violations.length > 0) {
  console.error(violations.sort().join('\n'));
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}
