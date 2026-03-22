#!/usr/bin/env node
/**
 * Runtime OpenAPI generator - runs OpenApi.fromApi on a user's HttpApi.
 * Usage: npx tsx openapi-runtime-runner.mjs <entrypoint> [exportName] [--output file.json]
 *
 * Requires: @effect/platform, tsx (for .ts files)
 * Run with: npx tsx openapi-runtime-runner.mjs ./src/api.ts TodoApi
 *
 * Must be run with cwd = project root (so @effect/platform resolves from project's node_modules).
 */

import { resolve, join } from 'path';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const outputIdx = args.indexOf('--output');
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null;
if (outputIdx >= 0) args.splice(outputIdx, 2);
const [entrypoint, exportName = 'default'] = args;

if (!entrypoint) {
  console.error('Usage: npx tsx openapi-runtime-runner.mjs <entrypoint> [exportName] [--output file.json]');
  console.error('Example: npx tsx openapi-runtime-runner.mjs ./src/api.ts TodoApi -o openapi.json');
  process.exit(1);
}

async function main() {
  let OpenApi;
  try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    const platform = require('@effect/platform');
    OpenApi = platform.OpenApi;
  } catch (e) {
    console.error('Error: @effect/platform is required for runtime OpenAPI generation.');
    console.error('Install it: pnpm add @effect/platform');
    if (e?.message) console.error('Details:', e.message);
    process.exit(1);
  }

  const absPath = entrypoint.startsWith('/') || /^[A-Za-z]:/.test(entrypoint)
    ? entrypoint
    : resolve(process.cwd(), entrypoint);
  const mod = await import(pathToFileURL(absPath).href);
  const api = mod[exportName] ?? mod.default;
  if (!api) {
    console.error(`Error: No export "${exportName}" found in ${entrypoint}`);
    process.exit(1);
  }

  const spec = OpenApi.fromApi(api);
  const json = JSON.stringify(spec, null, 2);

  if (outputFile) {
    writeFileSync(outputFile, json, 'utf8');
    console.error(`Wrote OpenAPI spec to ${outputFile}`);
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
