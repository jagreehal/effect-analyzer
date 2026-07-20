# Migrate one file, end to end

A worked example for the [Migrate One File](../../apps/docs/src/content/docs/project/migrate-one-file.mdx)
tutorial.

- **`before.ts`** — a typical legacy service (no Effect): `async/await`, `try/catch`,
  `Promise.all`, `fetch`, `process.env`, `setTimeout`, `throw`, class-based DI.
- **`after.ts`** — the same service migrated to idiomatic Effect, one pattern at a time.

## Reproduce the analyzer output

From the repo root:

```bash
# What needs to change, and where:
node packages/effect-analyzer/dist/cli.js examples/migrate-one-file/before.ts --format migration

# Verify the migration closed the loop (expect 0 opportunities):
node packages/effect-analyzer/dist/cli.js examples/migrate-one-file/after.ts --format migration

# Measure Effect adoption across the folder (expect 50% — one of two files migrated):
node packages/effect-analyzer/dist/cli.js examples/migrate-one-file --coverage-audit
```

(Or `npx effect-analyze ...` once the package is installed.)

## Type-checking

`before.ts` and `after.ts` are type-checked against the **real** `effect` and
Effect v4 HTTP types (resolved from the `effect-analyzer` package's install
via `tsconfig.json` `paths`) — so the migration target is guaranteed to compile,
not just illustrative. This runs as part of `pnpm quality`, or on its own from
the repo root:

```bash
pnpm run tc:examples
```
