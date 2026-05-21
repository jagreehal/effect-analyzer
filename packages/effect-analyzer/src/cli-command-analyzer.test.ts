import { describe, it, expect } from 'vitest';
import { analyzeCliCommandsSource } from './cli-command-analyzer';

describe('cli-command-analyzer', () => {
  it('detects Command.make with name', () => {
    const r = analyzeCliCommandsSource(
      `import { Command } from '@effect/cli';
       const cmd = Command.make("hello", {});`,
    );
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0]?.name).toBe('hello');
  });

  it('parses Args and Options inside Command.make', () => {
    const r = analyzeCliCommandsSource(
      `import { Command, Args, Options } from '@effect/cli';
       const cmd = Command.make("greet", {
         name: Args.text({ name: "name" }),
         loud: Options.boolean("loud"),
       });`,
    );
    const c = r.commands[0]!;
    const argKinds = c.args.map((a) => a.kind);
    const optKinds = c.options.map((o) => o.kind);
    expect(argKinds).toContain('text');
    expect(optKinds).toContain('boolean');
  });

  it('detects pipe(Command.withHandler(...)) as hasHandler', () => {
    const r = analyzeCliCommandsSource(
      `import { Command } from '@effect/cli';
       import { Effect } from 'effect';
       const cmd = Command.make("hello", {}).pipe(
         Command.withHandler(() => Effect.succeed(0))
       );`,
    );
    expect(r.commands[0]?.hasHandler).toBe(true);
  });

  it('detects Command.run', () => {
    const r = analyzeCliCommandsSource(
      `import { Command } from '@effect/cli';
       declare const root: any;
       Command.run(root, { name: "my-cli", version: "1.0.0" });`,
    );
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]?.name).toBe('my-cli');
    expect(r.runs[0]?.version).toBe('1.0.0');
  });

  it('detects Prompt.* calls at file scope', () => {
    const r = analyzeCliCommandsSource(
      `import { Command, Prompt } from '@effect/cli';
       const cmd = Command.make("setup", {});
       declare const promptInput: ReturnType<typeof Prompt.text>;
       const askName = Prompt.text({ message: "What is your name?" });
       const pickMode = Prompt.select({ message: "Mode?", choices: [] });`,
    );
    const c = r.commands[0]!;
    const promptKinds = c.prompts.map((p) => p.kind);
    expect(promptKinds).toContain('text');
    expect(promptKinds).toContain('select');
  });

  it('returns empty when no @effect/cli usage', () => {
    const r = analyzeCliCommandsSource(
      `import { Effect } from 'effect';
       export const p = Effect.succeed(1);`,
    );
    expect(r.commands).toEqual([]);
    expect(r.runs).toEqual([]);
  });
});
