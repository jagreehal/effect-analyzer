/**
 * Advanced state-machine fixtures exercising the hardened detection paths:
 *  - block-body Match.when handlers (return statements)
 *  - a guarded handler with multiple returned tags (one edge per target)
 *  - an explicit `initial` declaration
 *  - an `@initial` annotation on a transition table
 */

import { Match } from 'effect';

// ---------------------------------------------------------------------------
// Block-body handlers + guarded (multi-target) transition + initial const
// ---------------------------------------------------------------------------

type JobState =
  | { readonly _tag: 'Queued' }
  | { readonly _tag: 'Running' }
  | { readonly _tag: 'Done' }
  | { readonly _tag: 'Failed' };

type JobEvent =
  | { readonly _tag: 'Start' }
  | { readonly _tag: 'Finish' }
  | { readonly _tag: 'Error' };

// Picked up as the initial state for the machine that contains "Queued".
const initialState: JobState = { _tag: 'Queued' };
void initialState;

export const jobTransition = (state: JobState, event: JobEvent): JobState =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Queued', 'Start'], () => {
      return { _tag: 'Running' as const };
    }),
    Match.when(['Running', 'Finish'], () => {
      // guarded: success goes to Done, otherwise Failed
      if (Math.random() > 0.5) {
        return { _tag: 'Done' as const };
      }
      return { _tag: 'Failed' as const };
    }),
    Match.when(['Running', 'Error'], () => {
      return { _tag: 'Failed' as const };
    }),
    Match.orElse(() => state),
  );

// ---------------------------------------------------------------------------
// Transition table with an annotation overriding the first-key default
// ---------------------------------------------------------------------------

/** @initial Open */
export const gateTransitions = {
  Closed: { Unlock: 'Open' },
  Open: { Lock: 'Closed' },
} as const;
