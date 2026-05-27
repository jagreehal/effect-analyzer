# Effect State Machine Conventions

Write state machines as ordinary Effect and TypeScript. `effect-analyzer` reads
these conventions and renders XState-style diagrams, exports a Stately config,
and checks the machine for completeness. No XState runtime ends up in your code.

## Quickstart

Write a transition function over two tagged unions and mark the initial state:

```ts
import { Match } from 'effect'

type State = { readonly _tag: 'Closed' } | { readonly _tag: 'Open' }
type Event = { readonly _tag: 'Toggle' }

/** @initial Closed */
export const door = (state: State, event: Event): State =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Closed', 'Toggle'], () => ({ _tag: 'Open' as const })),
    Match.when(['Open', 'Toggle'], () => ({ _tag: 'Closed' as const })),
    Match.orElse(() => state),
  )
```

Run it with no flags — the default view surfaces any state machine in the file:

```bash
npx effect-analyze ./door.ts
```

For the full visualizer, ask for `statechart-html`. With no `-o` it writes
`door.statechart.html` next to the input. Add `--open` to launch it:

```bash
npx effect-analyze ./door.ts --format statechart-html --open
```

That page carries the statechart, a coverage report, and an XState config you
can paste into stately.ai/viz.

## Contract

A state machine is a deterministic function shaped like this:

```ts
type Transition = (state: State, event: Event) => State;
```

Use one of these alphabets:

- Tagged unions: `{ readonly _tag: 'Draft' } | { readonly _tag: 'Review' }`
- `Schema.TaggedClass` / `Schema.TaggedRequest` unions
- `Schema.Schema.Type<typeof SomeTaggedUnion>`
- Plain string-literal unions: `'Draft' | 'Review'`

Mark the start with an `@initial <State>` comment on the declaration, or a
sibling declaration named `initial`, `initialState`, `startState`, or `start`.

## Supported Authoring Styles

### Transition Table

Use a nested object where outer keys are states and inner keys are events.
Leaves may be strings, target objects, or guarded target arrays.

```ts
/** @initial Draft */
export const transitions = {
  Draft: {
    Submit: 'Review',
  },
  Review: {
    Approve: { target: 'Published', guard: 'canPublish' },
    Reject: [{ target: 'Draft', guard: 'needsChanges' }],
  },
  Published: {},
} as const satisfies Record<
  State['_tag'],
  Partial<Record<Event['_tag'], State['_tag'] | { readonly target: State['_tag']; readonly guard?: string }>>
>;
```

A string leaf and a `{ target }` object mean the same thing. The `guard` string
is a label: the analyzer prints it on the edge and in the exported config, but
never runs it. Keep the real check in your own code.

### Match.when

Use a tuple pattern `[state, event]`. Return the next state as either a tagged
object or a string literal.

```ts
/** @initial Draft */
export const transition = (state: State, event: Event): State =>
  Match.value([state._tag, event._tag] as const).pipe(
    Match.when(['Draft', 'Submit'], () => ({ _tag: 'Review' as const })),
    Match.when(['Review', 'Approve'], () => ({ _tag: 'Published' as const })),
    Match.when(['Review', 'Reject'], () => ({ _tag: 'Draft' as const })),
    Match.orElse(() => state),
  );
```

When a handler returns different states under `if` branches, the analyzer emits
one transition per target and labels each edge with the branch condition.

For a string-literal alphabet, drop `._tag` and return the string:

```ts
Match.when(['Red', 'Tick'], () => 'Green' as const)
```

### Nested Match.tags

Outer tags are source states; inner tags are events. The analyzer ignores a
single-level `Match.tags`, reading it as ordinary variant dispatch.

```ts
export const transition = (state: State, event: Event): State =>
  Match.value(state).pipe(
    Match.tags({
      Draft: () =>
        Match.value(event).pipe(
          Match.tags({
            Submit: () => ({ _tag: 'Review' as const }),
          }),
        ),
      Review: () =>
        Match.value(event).pipe(
          Match.tags({
            Approve: () => ({ _tag: 'Published' as const }),
            Reject: () => ({ _tag: 'Draft' as const }),
          }),
        ),
      Published: () => state,
    }),
  );
```

## Tooling Outputs

```bash
npx effect-analyze ./workflow.ts --format statechart-html -o statechart.html
npx effect-analyze ./workflow.ts --format xstate-config
npx effect-analyze ./workflow.ts --format mermaid-statechart
npx effect-analyze ./workflow.ts --format svg-statechart
npx effect-analyze ./workflow.ts --format statechart-coverage
```

`statechart-html` is the local visualizer: SVG diagram, coverage report, and
paste-ready XState config in one page. `xstate-config` is for Stately import.

## Coverage Gate

The analyzer compares extracted transitions with the declared state/event
alphabet and reports:

- Unhandled declared events
- Unreachable states
- Undeclared states or events used by transitions
- Final states with no outgoing transition

For CI:

```bash
npx effect-analyze ./src --format statechart-coverage
npx effect-analyze ./src --format statechart-coverage --min-coverage 60
npx effect-analyze ./src --format statechart-coverage --coverage-json
```

The command exits non-zero when warnings exist or a minimum coverage threshold
is missed.

## When detection fails

A command that finds no machines lists the declarations that came close and why.
A `Match.when` whose handler returns a computed value instead of a literal state
reports `a Match.when handler does not return a literal next state`, with the
file, line, and a fix. Each run also prints a header naming the machines it found
and their state and event counts.

## Non-Goals

This is not an XState runtime clone. Keep application code as plain functions
and data. Do not introduce actors, interpreters, services, nested states, or
parallel-state semantics unless the project already has a clear Effect-native
convention for them.

Optional helpers should remain zero-runtime metadata/inference helpers. Add
them only when repeated boilerplate appears in real user code.
