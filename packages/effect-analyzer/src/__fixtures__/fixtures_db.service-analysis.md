# Service: Fixtures/Db

## Definition

- **Class**: `Db`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:42`
- **Tag**: `'Fixtures/Db'`
- **Type**: `{
    readonly query: (sql: string) => Effect.Effect<string>;
  }`

## Interface

**Methods:**
- `query`

## Layer Implementations

### DbLive (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:69`)

- **Kind**: Layer.effect
- **Requires**: (none)

### LayerGraph (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:69`)

- **Kind**: Layer.other
- **Requires**: (none)

### AppLayer (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts:69`)

- **Kind**: Layer.other
- **Requires**: (none)
