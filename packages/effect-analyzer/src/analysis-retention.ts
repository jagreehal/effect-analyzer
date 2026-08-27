/**
 * Last-good retention for incremental analysis.
 *
 * A file saved mid-edit does not parse, and re-analyzing it produces nothing.
 * Blanking the previous output on every keystroke makes watch mode and the LSP
 * unusable, so a failure that follows a success degrades to `partial`: the last
 * valid result stays visible and the diagnostics ride alongside it.
 */

/**
 * `ready` — the current source analyzed cleanly.
 * `partial` — the current source failed; `value` is the last good result.
 * `failed` — the current source failed and nothing good has been seen yet.
 */
export type AnalysisStatus = 'ready' | 'partial' | 'failed';

export interface RetainedAnalysis<A> {
  readonly status: AnalysisStatus;
  /** The newest valid result, which may predate the current source. */
  readonly value: A | undefined;
  /** Diagnostics from the current attempt; empty when `ready`. */
  readonly diagnostics: readonly string[];
}

export interface Retainer<A> {
  readonly succeed: (value: A) => RetainedAnalysis<A>;
  readonly fail: (...diagnostics: readonly string[]) => RetainedAnalysis<A>;
  /** The retained value without recording an attempt. */
  readonly latest: () => A | undefined;
}

/** A retainer holding the newest valid result for one analysis target. */
export function makeRetainer<A>(): Retainer<A> {
  let retained: A | undefined;

  return {
    succeed: (value) => {
      retained = value;
      return { status: 'ready', value, diagnostics: [] };
    },
    fail: (...diagnostics) => ({
      status: retained === undefined ? 'failed' : 'partial',
      value: retained,
      diagnostics,
    }),
    latest: () => retained,
  };
}
