# Service: UserRepo

## Definition

- **Class**: `UserRepo`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts:7`
- **Tag**: `'UserRepo'`
- **Type**: `{
    readonly getById: (id: string) => Effect.Effect<{ name: string }, { _tag: 'NotFound' }>;
  }`

## Interface

**Methods:**
- `getById`

## Layer Implementations

### UserRepoLive (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:49`)

- **Kind**: Layer.succeed
- **Requires**: (none)

### LayerGraph (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:49`)

- **Kind**: Layer.other
- **Requires**: (none)

### AppLayer (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:49`)

- **Kind**: Layer.other
- **Requires**: (none)

## Consumers (1 program)

- `userLookupProgram` in `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts:28`
