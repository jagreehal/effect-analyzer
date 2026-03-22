---
name: effect-analyzer
description: Use when working on the effect-analyzer package - static analysis for Effect-TS code. Covers architecture, IR types, adding analyzers, output renderers, CLI flags, testing with fixtures, and the fluent analyze() API. Triggers on changes to packages/effect-analyzer or questions about Effect program analysis, mermaid diagrams, or IR nodes.
---

# effect-analyzer

Static analysis tool for Effect-TS programs. Parses TypeScript via `ts-morph`, builds an IR (Intermediate Representation), then renders diagrams, metrics, and reports without executing code.

## Architecture

```
CLI (cli.ts)
  → analyze.ts (fluent API: analyze(path).single() | .all() | .named())
    → static-analyzer.ts (analyzeEffectFile / analyzeEffectSource)
      → program-discovery.ts (find Effect programs in AST)
      → core-analysis.ts (build IR tree from AST nodes)
        → effect-analysis.ts (pipes, calls, generators)
        → alias-resolution.ts (resolve Effect aliases/re-exports)
        → type-extractor.ts (extract Effect/Stream/Layer type signatures)
      → output/*.ts (render IR → mermaid, json, html, explain, etc.)
```

**Key data flow:** Source file → ts-morph AST → `StaticEffectIR` (IR) → output format

## Core Types

**IR root:**
```typescript
StaticEffectIR { root: StaticEffectProgram, metadata, serviceDefinitions, warnings }
```

**Programs contain children — a tree of `StaticFlowNode` (30+ types):**
- `effect` — individual Effect calls (with `callee`, `semanticRole`, `serviceCall`)
- `generator` / `pipe` — Effect.gen blocks and pipe chains
- `parallel` / `race` — concurrency patterns
- `error-handler` — catch/catchAll/catchTag (37 handler variants)
- `retry` / `timeout` / `resource` — resilience patterns
- `conditional` / `decision` / `switch` — control flow
- `layer` / `stream` / `fiber` — Effect ecosystem constructs
- `transform` — map/flatMap/tap operations
- `opaque` / `unknown` — unsupported or unanalyzable
- Plus: `terminal`, `try-catch`, `loop`, `cause`, `exit`, `schedule`, `match`, `scope-resource`, and more

All types use `readonly` everywhere. See `StaticFlowNode` union in `src/types.ts` for the full set.

## Quick Reference

### Adding a New Analyzer

1. Create `src/my-analysis.ts` with a function taking `StaticEffectIR`
2. Export from `src/index.ts`
3. Walk IR tree recursively:
   ```typescript
   import { getStaticChildren } from './analysis-utils';
   function visit(node: StaticFlowNode) {
     // process node
     for (const child of getStaticChildren(node)) visit(child);
   }
   visit(ir.root); // ir.root is the top-level StaticEffectProgram
   ```
4. Add tests with fixtures in `src/__fixtures__/`

### Adding a New Output Format

1. Create `src/output/my-format.ts` with render function taking `StaticEffectIR`
2. Export from `src/index.ts`
3. Add CLI flag in `src/cli.ts` under the `--format` option
4. Add to `src/output/auto-diagram.ts` if it should be auto-selected

### Adding a New Node Type

1. Add type to `StaticFlowNode` union in `src/types.ts`
2. Handle in `core-analysis.ts` or `effect-analysis.ts`
3. Update `getStaticChildren()` in `analysis-utils.ts`
4. Handle in relevant output renderers (`output/mermaid.ts`, etc.)

## Testing

**Framework:** Vitest. Tests colocated as `*.test.ts`.

**Pattern:** Fixture-based analysis validation:
```typescript
import { analyze } from './analyze';
import { Effect } from 'effect';

it('detects parallel patterns', { timeout: 20_000 }, async () => {
  const irs = await Effect.runPromise(analyze(fixturePath).all());
  expect(irs.length).toBeGreaterThanOrEqual(1);
  // Check node types, diagram content, etc.
});
```

**Fixtures:** `src/__fixtures__/*.ts` — add new patterns here, then reference in tests.

**For source-level tests (no fixture file):**
```typescript
import { analyzeEffectSource } from './static-analyzer';
const [ir] = await Effect.runPromise(analyzeEffectSource(`
  import { Effect } from "effect";
  export const myProgram = Effect.gen(function* () { ... });
`));
```

**Run:** `pnpm test` (all), `pnpm test:watch` (dev), `pnpm quality` (lint + type-check + test)

## Build

```bash
pnpm build       # tsup: 3 entries (library, CLI, LSP)
pnpm type-check  # tsc --noEmit
pnpm lint        # eslint src
pnpm quality     # type-check && test && lint
```

**Entries:** `src/index.ts` (library), `src/cli.ts` (CLI), `src/lsp/server.ts` (LSP)

## Key Patterns

- **Effect-first:** All async operations use `Effect.gen`, `Effect.try`, `Effect.forEach`
- **Visitor pattern:** Recursive walks via `getStaticChildren(node)`
- **WeakMap caching:** `effectAliasCache`, `nodeTextCache` keyed by SourceFile/Node
- **Pattern maps:** `ERROR_HANDLER_PATTERNS`, `CONDITIONAL_PATTERNS`, `TRANSFORM_OPS` in `analysis-patterns.ts`
- **Typed errors:** `AnalysisError` with codes (`NO_EFFECTS_FOUND`, `FILE_NOT_FOUND`)
- **Semantic roles:** Nodes tagged with `SemanticRole` for filtering/styling

## CLI Formats

`effect-analyze <path> --format <fmt>`:

| Format | Description |
|--------|-------------|
| `auto` | Best diagram for program |
| `json` | Raw IR as JSON |
| `mermaid` | Generic flowchart |
| `mermaid-railway` | Happy path + error branches |
| `mermaid-services` | Service dependency map |
| `mermaid-errors` | Error propagation |
| `mermaid-decisions` | Control flow |
| `mermaid-concurrency` | Parallel/race |
| `mermaid-layers` | Layer composition |
| `mermaid-timeline` | Step sequence |
| `mermaid-dataflow` | Variable flow |
| `explain` | Plain-English narrative |
| `summary` | One-liner |
| `stats` | Complexity metrics |
| `matrix` | Dependency matrix |
| `api-docs` | API documentation |
| `migration` | Migration opportunities |

## Common Mistakes

- **Forgetting `readonly`** on new type fields — all IR types are immutable
- **Not handling new node types** in `getStaticChildren` — causes silent omission in traversals
- **Long timeouts in tests** — ts-morph project creation is slow; use `{ timeout: 20_000 }`
- **Mutating IR** — create new objects, never mutate existing nodes
