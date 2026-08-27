#!/usr/bin/env node
/**
 * Isolated runtime probe.
 *
 * Imports one module from the target project and answers a single structured
 * question about it, then exits. Runs as its own process so a module that
 * throws, hangs, or calls `process.exit` during initialization cannot take the
 * analyzer down with it, and so `effect` resolves from the *project's*
 * node_modules rather than the analyzer's.
 *
 * Usage: npx tsx runtime-probe-runner.mjs <entrypoint> <request-json>
 * Emits a single JSON line on stdout: { ok: true, value } | { ok: false, error }
 *
 * SECURITY: importing a module runs its top-level code. Only probe projects you
 * trust. Nothing here calls into user functions beyond that import.
 */

import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';

const emit = (payload) => {
  process.stdout.write(JSON.stringify(payload));
};

const fail = (error) => {
  emit({ ok: false, error });
  process.exit(0);
};

async function main() {
  const [entrypoint, requestJson] = process.argv.slice(2);
  if (!entrypoint || !requestJson) {
    fail('Usage: runtime-probe-runner.mjs <entrypoint> <request-json>');
  }

  let request;
  try {
    request = JSON.parse(requestJson);
  } catch {
    fail(`Request is not valid JSON: ${requestJson}`);
  }

  const absPath =
    entrypoint.startsWith('/') || /^[A-Za-z]:/.test(entrypoint)
      ? entrypoint
      : resolve(process.cwd(), entrypoint);

  let mod;
  try {
    mod = await import(pathToFileURL(absPath).href);
  } catch (e) {
    fail(`Could not import ${entrypoint}: ${e?.message ?? String(e)}`);
  }

  if (request.kind === 'exports') {
    emit({ ok: true, value: Object.keys(mod) });
    return;
  }

  if (request.kind === 'json-schema') {
    const value = mod[request.exportName];
    if (value === undefined) {
      fail(`No export "${request.exportName}" in ${entrypoint}`);
    }
    let Schema;
    try {
      // Resolve `effect` from the probed module, not from cwd. The module has
      // already imported its own `effect` by the time we get here; resolving
      // from anywhere else can load a second, different instance, and then
      // `toJsonSchemaDocument` does not recognise the refinements the first
      // instance created and silently drops them. A schema missing its
      // constraints is worse than no schema, because it looks like an answer.
      const require = createRequire(absPath);
      Schema = require('effect/Schema');
    } catch (e) {
      fail(`Effect is not resolvable from ${entrypoint}: ${e?.message ?? String(e)}`);
    }
    if (typeof Schema.toJsonSchemaDocument !== 'function') {
      fail('This version of effect has no Schema.toJsonSchemaDocument');
    }
    try {
      emit({ ok: true, value: Schema.toJsonSchemaDocument(value) });
    } catch (e) {
      fail(`"${request.exportName}" is not a Schema: ${e?.message ?? String(e)}`);
    }
    return;
  }

  fail(`Unknown probe kind: ${String(request.kind)}`);
}

main().catch((e) => fail(e?.message ?? String(e)));
