#!/usr/bin/env node
/**
 * The playground runs its analysis in a module worker. A bundler that emits an
 * empty worker chunk produces no error anywhere: the file still serves as 200
 * `application/javascript`, an empty module is a *valid* module, so it loads
 * without firing `error` — it just never registers a `message` listener and
 * never replies. The page sits on "Analyzing in worker..." forever.
 *
 * That is exactly what shipped: rolldown silently emitted a 0-byte chunk when
 * `output/html.ts` spliced a regex across template-literal boundaries. Nothing
 * in the build, the types, or the tests noticed.
 *
 * So: assert after every build that the worker chunk exists and actually
 * contains the listener it is built around.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distAstro = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', '_astro');

const entries = await readdir(distAstro).catch(() => {
  throw new Error(`No build output at ${distAstro} — run the docs build first.`);
});

const workers = entries.filter((name) => /^playground-worker-.*\.js$/.test(name));
if (workers.length === 0) {
  throw new Error('No playground-worker chunk was emitted; the playground cannot run.');
}

for (const worker of workers) {
  const source = await readFile(join(distAstro, worker), 'utf8');
  if (source.trim() === '') {
    throw new Error(
      `${worker} is empty. An empty module worker loads without error and never ` +
        'replies, so the playground hangs on "Analyzing in worker...". This is ' +
        'usually a bundler tree-shaking or parse failure in the worker import graph.',
    );
  }
  if (!source.includes('addEventListener')) {
    throw new Error(
      `${worker} contains no addEventListener call, so it can never answer the ` +
        'page. The worker entry was bundled without its message handler.',
    );
  }
}

console.log(
  `playground worker OK (${workers.join(', ')})`,
);
