# Service: Logger

## Definition

- **Class**: `Logger`
- **File**: `packages/effect-analyzer/src/__fixtures__/context-services.ts:44`
- **Tag**: `'Logger'`
- **Type**: `{
    readonly info: (message: string) => Effect.Effect<void>;
    readonly error: (message: string, error: unknown) => Effect.Effect<void>;
    readonly debug: (message: string) => Effect.Effect<void>;
  }`

## Interface

**Methods:**
- `info`
- `error`
- `debug`

## Layer Implementations

### LoggerLive (`packages/effect-analyzer/src/__fixtures__/context-services.ts:141`)

- **Kind**: Layer.succeed
- **Requires**: (none)

### LoggerLive (`packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts:33`)

- **Kind**: Layer.sync
- **Requires**: (none)

### AppLayer (`packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts:39`)

- **Kind**: Layer.sync
- **Requires**: (none)

### AppLayer (`packages/effect-analyzer/src/__fixtures__/context-services.ts:141`)

- **Kind**: Layer.other
- **Requires**: (none)
