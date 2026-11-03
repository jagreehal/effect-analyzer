# Service: Fixtures/Db

## Definition

- **Class**: `Db`
- **File**: `packages/effect-analyzer/src/__fixtures__/services.ts:42`
- **Tag**: `'Fixtures/Db'`
- **Type**: `{
    readonly query: (sql: string) => Effect.Effect<string>;
  }`

## Interface

**Methods:**
- `query`

## Layer Implementations

### DbLive (`packages/effect-analyzer/src/__fixtures__/services.ts:69`)

- **Kind**: Layer.effect
- **Requires**: (none)

### LayerGraph (`packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:69`)

- **Kind**: Layer.other
- **Requires**: (none)

### AppLayer (`packages/effect-analyzer/src/__fixtures__/services.ts:69`)

- **Kind**: Layer.other
- **Requires**: (none)
