/**
 * State machine fixtures — plain Effect, no XState.
 *
 * Two shapes the analyzer should recognize:
 *  A) a declarative transition table (object literal)
 *  B) a Match.value([state, event]).pipe(Match.when([from, event], () => toState)) function
 */

import { Match } from 'effect';

// ---------------------------------------------------------------------------
// Shape A: declarative transition table
// ---------------------------------------------------------------------------

type SupportState =
  | { readonly _tag: 'Triage' }
  | { readonly _tag: 'Refund' }
  | { readonly _tag: 'Human' }
  | { readonly _tag: 'Answered' };

type SupportEvent =
  | { readonly _tag: 'RefundRequested' }
  | { readonly _tag: 'EscalationRequested' }
  | { readonly _tag: 'AnswerRequested' }
  | { readonly _tag: 'Resolved' };

export const supportTransitions = {
  Triage: {
    RefundRequested: 'Refund',
    EscalationRequested: 'Human',
    AnswerRequested: 'Answered',
  },
  Refund: {
    Resolved: 'Answered',
  },
  Human: {
    Resolved: 'Answered',
  },
  Answered: {},
} as const satisfies Record<
  SupportState['_tag'],
  Partial<Record<SupportEvent['_tag'], SupportState['_tag']>>
>;

// ---------------------------------------------------------------------------
// Shape B: Match.when tuple transition function
// ---------------------------------------------------------------------------

type DocState =
  | { readonly _tag: 'Draft' }
  | { readonly _tag: 'Review' }
  | { readonly _tag: 'Published' };

type DocEvent =
  | { readonly _tag: 'Submit' }
  | { readonly _tag: 'Approve' }
  | { readonly _tag: 'Reject' };

export const docTransition = (state: DocState, event: DocEvent): DocState =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Draft', 'Submit'], () => ({ _tag: 'Review' as const })),
    Match.when(['Review', 'Approve'], () => ({ _tag: 'Published' as const })),
    Match.when(['Review', 'Reject'], () => ({ _tag: 'Draft' as const })),
    Match.orElse(() => state),
  );
