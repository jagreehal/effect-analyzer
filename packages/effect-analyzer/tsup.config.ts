import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library
  {
    entry: {
      index: 'src/index.ts',
      browser: 'src/browser.ts',
      'effect-workflow': 'src/effect-workflow.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
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
