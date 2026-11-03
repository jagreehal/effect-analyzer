# Service: UserRepo

## Definition

- **Class**: `UserRepo`
- **File**: `packages/effect-analyzer/src/__fixtures__/rich-labels.ts:7`
- **Tag**: `'UserRepo'`
- **Type**: `{
    readonly getById: (id: string) => Effect.Effect<{ name: string }, { _tag: 'NotFound' }>;
  }`

## Interface

**Methods:**
- `getById`

## Layer Implementations

### UserRepoLive (`packages/effect-analyzer/src/__fixtures__/services.ts:49`)

- **Kind**: Layer.succeed
- **Requires**: (none)

### LayerGraph (`packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:49`)

- **Kind**: Layer.other
- **Requires**: (none)

### AppLayer (`packages/effect-analyzer/src/__fixtures__/services.ts:49`)

- **Kind**: Layer.other
- **Requires**: (none)

## Consumers (1 program)

- `userLookupProgram` in `packages/effect-analyzer/src/__fixtures__/testing-mocks.ts:28`
