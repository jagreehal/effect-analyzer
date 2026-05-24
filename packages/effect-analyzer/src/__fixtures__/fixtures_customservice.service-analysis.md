# Service: Fixtures/CustomService

## Definition

- **Class**: `CustomService`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:34`
- **Tag**: `'Fixtures/CustomService'`
- **Type**: `{
    readonly doWork: (id: string) => Effect.Effect<number>;
    readonly buildProfile: (id: string) => Effect.Effect<string>;
  }`

## Interface

**Methods:**
- `doWork`
- `buildProfile`

## Layer Implementations

### CustomServiceLive (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:64`)

- **Kind**: Layer.succeed
- **Requires**: (none)

### LayerGraph (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:64`)

- **Kind**: Layer.other
- **Requires**: Fixtures/CustomService

### AppLayer (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:64`)

- **Kind**: Layer.other
- **Requires**: Fixtures/CustomService

## Dependencies

- Fixtures/CustomService
