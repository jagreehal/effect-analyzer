import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  extractProjectArchitecture,
  renderProjectArchitecture,
} from './project-architecture';

describe('project architecture extraction', () => {
  it('detects foldkit-style runtimes and command definitions', () => {
    const root = mkdtempSync(join(tmpdir(), 'effect-analyze-architecture-'));

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        join(srcDir, 'commands.ts'),
        `
import * as Command from "./runtime";

export const Refresh = Command.define("Refresh");
export const Save = Command.define("Save");
`,
        'utf8',
      );

      writeFileSync(
        join(srcDir, 'main.ts'),
        `
import * as Runtime from "./runtime";
import { Refresh, Save } from "./commands";
import { Layer } from "effect";

declare const Model: unknown;
declare const Flags: unknown;
declare const flags: unknown;
declare const init: unknown;
declare const update: unknown;
declare const view: unknown;
declare const resources: unknown;
declare const managedResources: unknown;
declare const makeSubscriptions: unknown;
declare const container: HTMLElement;
declare const RuntimeServices: unknown;
declare const ProviderServices: unknown;

export const program = Runtime.makeProgram({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  container,
  subscriptions: makeSubscriptions,
  resources,
  managedResources,
  routing: {
    onUrlRequest: request => request,
    onUrlChange: url => url,
  },
  crash: {
    view: context => context,
    report: context => context,
  },
  slowView: false,
  title: model => String(model),
  devtools: false,
});

export const LayerLive = Layer.empty.pipe(
  Layer.provideMerge(RuntimeServices),
  Layer.provideMerge(ProviderServices),
);

void Refresh;
void Save;
`,
        'utf8',
      );

      writeFileSync(
        join(srcDir, 'main.test.ts'),
        `
import { Layer } from "effect";

declare const TestDb: unknown;

export const TestLayer = Layer.succeed(TestDb, {});
`,
        'utf8',
      );

      const summary = extractProjectArchitecture([
        join(srcDir, 'commands.ts'),
        join(srcDir, 'main.ts'),
        join(srcDir, 'main.test.ts'),
      ]);

      expect(summary.runtimes).toHaveLength(1);
      expect(summary.commandDefinitions.map((command) => command.commandName)).toEqual([
        'Refresh',
        'Save',
      ]);
      expect(summary.layerAssemblies).toHaveLength(2);
      expect(summary.layerAssemblies[0]?.operations).toEqual([
        'empty.pipe',
        'provideMerge',
        'provideMerge',
      ]);
      expect(summary.layerAssemblies[0]?.references).toContain('RuntimeServices');

      const runtime = summary.runtimes[0]!;
      expect(runtime.runtimeName).toBe('program');
      expect(runtime.capabilities).toEqual([
        'flags',
        'routing',
        'subscriptions',
        'resources',
        'managedResources',
        'crash',
        'slowView',
        'title',
        'devtools',
      ]);
      expect(runtime.routingHandlers).toEqual(['onUrlRequest', 'onUrlChange']);
      expect(runtime.crashHandlers).toEqual(['view', 'report']);

      const rendered = renderProjectArchitecture(summary, srcDir);
      expect(rendered).toContain('Flags -> init -> Model + Commands');
      expect(rendered).toContain('Message -> update -> Model + Commands');
      expect(rendered).toContain('Routing:');
      expect(rendered).toContain('Command definitions:');
      expect(rendered).toContain('Layer assemblies:');
      expect(rendered).toContain('Test layer assemblies:');
      expect(rendered).toContain('provideMerge');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
