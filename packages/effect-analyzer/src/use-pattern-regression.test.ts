import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { renderExplanation } from './output/explain';

describe('use pattern semantics', () => {
  it('renders service wrapper .use calls as use-pattern callbacks', async () => {
    const source = `
      import { Context, Effect } from "effect";

      type FileModule = {
        readonly readFile: (path: string, signal: AbortSignal) => Promise<string>;
      };

      class FileClient extends Context.Tag("FileClient")<
        FileClient,
        {
          readonly use: <A>(
            fn: (fileModule: FileModule, signal: AbortSignal) => Promise<A>,
          ) => Effect.Effect<A>;
        }
      >() {}

      export const copyFile = Effect.gen(function* () {
        const fileClient = yield* FileClient;
        const contents = yield* fileClient.use((fs, signal) => fs.readFile("a.txt", signal));
        return contents.length;
      });
    `;

    const ir = await Effect.runPromise(analyze.source(source).named('copyFile'));
    const explanation = renderExplanation(ir);

    expect(explanation).toContain('Uses FileClient via .use callback');
    expect(explanation).toContain('Calls fs.readFile');
    expect(explanation).toContain('Services required: FileClient');
    expect(explanation).not.toContain('Services required: Effect');
  });
});
