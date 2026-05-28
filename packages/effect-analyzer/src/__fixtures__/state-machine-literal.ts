/**
 * Literal / intent-style state machine: State and Event are string-literal
 * unions (no `_tag`), and handlers return the next state as a bare string.
 * Exercises string-union alphabet extraction and string-literal handler returns.
 */

import { Match } from 'effect';

type Light = 'Red' | 'Yellow' | 'Green';
type Signal = 'Tick';

export const lightTransition = (state: Light, signal: Signal): Light =>
  Match.value([state, signal] as const).pipe(
    Match.when(['Red', 'Tick'], () => 'Green' as const),
    Match.when(['Green', 'Tick'], () => 'Yellow' as const),
    Match.when(['Yellow', 'Tick'], () => 'Red' as const),
    Match.orElse(() => state),
  );
