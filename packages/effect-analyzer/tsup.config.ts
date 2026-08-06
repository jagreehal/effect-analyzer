import { defineConfig } from 'tsup';

// Declarations are emitted by `tsc --emitDeclarationOnly` (see the `build`
// script), not by tsup. tsup bundles them via rollup-plugin-dts, which drives
// the TypeScript *JS* compiler API — TypeScript 7 is the native port and no
// longer exposes it (`ts.sys.useCaseSensitiveFileNames` is undefined).
export default defineConfig([
  // Main library
  {
    entry: {
      index: 'src/index.ts',
      analysis: 'src/analysis-entry.ts',
      diagram: 'src/diagram-entry.ts',
      rules: 'src/rules-entry.ts',
      migration: 'src/migration-entry.ts',
      browser: 'src/browser.ts',
      'effect-workflow': 'src/effect-workflow.ts',
    },
    format: ['cjs', 'esm'],
    dts: false,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: true,
    external: ['ts-morph', 'effect'],
  },
  // LSP server (GAP 23)
  {
    entry: {
      'lsp/server': 'src/lsp/server.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    minify: false,
    external: ['ts-morph', 'effect', 'vscode-languageserver', 'vscode-languageserver-textdocument'],
  },
  // CLI
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    minify: true,
    external: ['ts-morph', 'effect'],
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
