import { Match } from 'effect';
import { IdleState, RunningState } from './state-machine-imported-states';

type State = IdleState | RunningState;
type Event = { readonly _tag: 'Start' };

/** @initial Idle */
export const importedTransition = (state: State, event: Event): State =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Idle', 'Start'], () => new RunningState()),
    Match.orElse(() => state),
  );
