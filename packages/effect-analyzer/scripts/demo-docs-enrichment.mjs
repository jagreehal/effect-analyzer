#!/usr/bin/env node
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { lintSourceCode } = await import(join(__dirname, '..', 'dist', 'index.js'));

const code = `
import { Effect, Config } from 'effect';
export const tok = Config.string('API_TOKEN');
export const p = Effect.gen(function* () {
  console.log('starting');
  return yield* Effect.succeed(1);
});
`;

const r = lintSourceCode(code);
for (const issue of r.issues) {
  console.log('---');
  console.log('rule    :', issue.rule);
  console.log('message :', issue.message);
  console.log('docsUrl :', issue.docsUrl);
  if (issue.example) {
    console.log('example bad :');
    console.log('  ' + issue.example.bad.split('\n').join('\n  '));
    console.log('example good:');
    console.log('  ' + issue.example.good.split('\n').join('\n  '));
  }
}
