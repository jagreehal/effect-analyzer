# Service: Fixtures/AppConfig

## Definition

- **Class**: `AppConfig`
- **File**: `packages/effect-analyzer/src/__fixtures__/services.ts:26`
- **Tag**: `'Fixtures/AppConfig'`
- **Type**: `{
    readonly defaultUserId: string;
    readonly retryCount: number;
  }`

## Interface

**Properties:**
- `defaultUserId`
- `retryCount`

## Layer Implementations

### AppConfigLive (`packages/effect-analyzer/src/__fixtures__/services.ts:59`)

- **Kind**: Layer.succeed
- **Requires**: (none)

### LayerGraph (`packages/effect-analyzer/src/__fixtures__/effect-kitchen-sink.ts:59`)

- **Kind**: Layer.other
- **Requires**: (none)

### AppLayer (`packages/effect-analyzer/src/__fixtures__/services.ts:59`)

- **Kind**: Layer.other
- **Requires**: (none)
