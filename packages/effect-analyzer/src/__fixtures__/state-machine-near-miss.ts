/**
 * Declarations that look like state machines but are not recognized, used to
 * test the near-miss diagnostics. None of these should produce a machine.
 */

import { Match } from 'effect';

// Table-shaped, but no event leads to another state — reads as config.
export const settingsTransitions = {
  audio: { volume: 'high' },
  video: { quality: 'hd' },
} as const;

type S = { readonly _tag: 'A' } | { readonly _tag: 'B' };
type E = { readonly _tag: 'Go' };

function makeNext(): S {
  return { _tag: 'B' };
}

// Match.when with a 2-tuple, but the handler returns a computed (non-literal) state.
export const computedTransition = (state: S, event: E): S =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['A', 'Go'], () => makeNext()),
    Match.orElse(() => state),
  );

// Single-level Match.tags — variant dispatch, not a transition.
export const describe = (state: S): string =>
  Match.value(state).pipe(
    Match.tags({
      A: () => 'is A',
      B: () => 'is B',
    }),
  );
