# Service: Config

## Definition

- **Class**: `Config`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts:33`
- **Tag**: `'Config'`
- **Type**: `{
    readonly get: <A>(key: string) => Effect.Effect<A, ConfigError>;
    readonly getOrDefault: <A>(key: string, defaultValue: A) => Effect.Effect<A>;
  }`

## Interface

**Methods:**
- `get`
- `getOrDefault`

## Layer Implementations

### ConfigLive (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts:150`)

- **Kind**: Layer.effect
- **Requires**: (none)

### ConfigLive (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts:36`)

- **Kind**: Layer.sync
- **Requires**: (none)

### AppLayer (`/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts:150`)

- **Kind**: Layer.other
- **Requires**: (none)
