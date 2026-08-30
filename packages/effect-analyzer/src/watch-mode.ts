/**
 * Watch mode: re-analyze a path on every change, without losing the last good
 * render.
 *
 * A file saved mid-edit does not parse, and that is most saves while typing.
 * Clearing the screen before each run would blank the diagram every time, so
 * the render is buffered and the screen is cleared only once a run succeeds. A
 * failure that follows a success keeps the previous analysis on screen and
 * marks it stale.
 */

import { watch } from 'fs';
import { basename, dirname } from 'path';
import { Console, Effect } from 'effect';
import { makeRetainer, type RetainedAnalysis } from './analysis-retention';
import { captureStdout } from './capture-stdout';

const DEBOUNCE_MS = 300;

const CLEAR = '\x1Bc';
const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`;
const warn = (text: string): string => `\x1b[33m${text}\x1b[0m`;
const error = (text: string): string => `\x1b[31m${text}\x1b[0m`;

/** What one refresh puts on screen. */
export interface WatchFrame {
  /** The analysis itself; empty when there has never been a good one. */
  readonly body: string;
  /** Status lines shown under the body. */
  readonly trailer: readonly string[];
}

/**
 * Decide what a refresh shows. Pure, so the interesting case — a failure that
 * still has a good render behind it — is testable without a filesystem.
 */
export function frameFor(result: RetainedAnalysis<string>): WatchFrame {
  if (result.status === 'ready') {
    return { body: result.value ?? '', trailer: ['', dim('✓ Updated. Waiting for changes...')] };
  }
  const stale =
    result.status === 'partial'
      ? [warn('⚠ Showing the last valid analysis while this file is incomplete.')]
      : [];
  return {
    body: result.status === 'partial' ? (result.value ?? '') : '',
    trailer: [
      ...stale,
      ...result.diagnostics.map((diagnostic) => error(`✗ Error: ${diagnostic}`)),
      dim('Waiting for changes...'),
    ],
  };
}

/**
 * Serialize refreshes, collapsing a burst into a single follow-up.
 *
 * `captureStdout` swaps the global `process.stdout.write`, so two overlapping
 * analyses restore in the order they *finish*: the later one hands back a
 * capture function the earlier one has already abandoned, and every write after
 * that disappears into a dead buffer. Debouncing alone does not prevent this —
 * an analysis slower than the debounce window still overlaps the next one.
 *
 * Changes arriving mid-run collapse into one follow-up rather than a queue,
 * because only the newest state on disk is worth rendering.
 */
export const makeRefreshQueue = (run: () => Promise<unknown>): (() => void) => {
  let running = false;
  let queued = false;

  const drain = (): void => {
    running = true;
    void run().finally(() => {
      running = false;
      if (!queued) return;
      queued = false;
      drain();
    });
  };

  return () => {
    if (running) {
      queued = true;
      return;
    }
    drain();
  };
};

/** Re-runs `analyze` on every change to `path`. Never returns. */
export const runWatchMode = <O>(
  path: string,
  options: O,
  analyze: (path: string, options: O) => Effect.Effect<unknown, Error>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const quietOptions = { ...options, quiet: true };
    yield* Console.log(dim(`👁 Watching ${path} for changes... (Ctrl+C to stop)`));

    const retainer = makeRetainer<string>();
    const initial = yield* captureStdout(analyze(path, quietOptions)).pipe(
      Effect.match({
        onFailure: (cause) => retainer.fail(cause.message),
        onSuccess: (rendered) => retainer.succeed(rendered),
      }),
    );

    yield* Effect.sync(() => {
      let debounce: ReturnType<typeof setTimeout> | undefined;
      let runCount = 0;

      const render = (result: RetainedAnalysis<string>): void => {
        const { body, trailer } = frameFor(result);
        runCount += 1;
        process.stdout.write(CLEAR);
        process.stdout.write(
          dim(`👁 ${path} — ${new Date().toLocaleTimeString()} (#${runCount})`) + '\n\n',
        );
        process.stdout.write(body);
        for (const line of trailer) process.stdout.write(line + '\n');
      };

      render(initial);

      // Serialized, not just debounced: an analysis slower than the debounce
      // window would otherwise overlap the next one and strand `captureStdout`.
      const refresh = makeRefreshQueue(() =>
        // Detached on purpose: this is an fs.watch callback on a debounce
        // timer, not a child of the surrounding fiber. There are no custom
        // services to inherit, so runPromiseWith would only add an empty
        // context capture.
        // oxlint-disable-next-line effecttsgo/run-effect-inside-effect
        Effect.runPromise(
          captureStdout(analyze(path, quietOptions)).pipe(
            Effect.tap((rendered) =>
              Effect.sync(() => {
                render(retainer.succeed(rendered));
              }),
            ),
            Effect.catch((cause: Error) =>
              Effect.sync(() => {
                render(retainer.fail(cause.message));
              }),
            ),
          ),
        ).catch(() => undefined),
      );

      /**
       * The directory, not the file. `fs.watch` on a file watches that inode,
       * and an editor saving by rename unlinks it: Node then delivers one
       * `rename` and nothing ever again, leaving a registered, permanently deaf
       * watcher. A directory inode outlives its children. A null `filename` is
       * documented as possible, so it refreshes rather than being dropped.
       */
      const watched = basename(path);
      const watcher = watch(dirname(path), { persistent: true }, (_event, filename) => {
        if (filename !== null && basename(filename) !== watched) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(refresh, DEBOUNCE_MS);
      });

      process.on('SIGINT', () => {
        watcher.close();
        process.stdout.write('\n');
        process.exit(0);
      });
    });
  });
