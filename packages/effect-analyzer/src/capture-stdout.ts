/**
 * Run an effect with `process.stdout` buffered, returning what it wrote.
 *
 * Watch mode needs the rendered output as a value so it can decide whether to
 * clear the screen: clearing before the run blanks the last good diagram every
 * time the file is saved mid-edit.
 *
 * ponytail: swaps the global `process.stdout.write` for the duration, so it is
 * only safe while nothing else writes concurrently. Overlapping captures
 * restore in the order they finish, so the later one hands back a function the
 * earlier one already abandoned and all output after it is swallowed. Watch
 * mode is the only caller and serializes through `makeRefreshQueue` for exactly
 * that reason — a debounce alone does not, since an analysis slower than the
 * window still overlaps the next one. Thread output through a Console layer
 * instead if this is ever needed under real concurrency.
 */
import { Effect } from 'effect';

export const captureStdout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<string, E, R> =>
  Effect.suspend(() => {
    // Captured as a property value, not a bound method: restoring must put the
    // exact same function object back so nested captures compose.
    // oxlint-disable-next-line typescript/unbound-method
    const original = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = function capture(chunk: string | Uint8Array): boolean {
      // Stryker disable next-line all: the branches are indistinguishable once
      // `chunks.join('')` coerces them, so every mutant here is equivalent. The
      // ternary only avoids copying a string through a Buffer.
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    };

    return effect.pipe(
      Effect.map(() => chunks.join('')),
      Effect.ensuring(
        Effect.sync(() => {
          process.stdout.write = original;
        }),
      ),
    );
  });
