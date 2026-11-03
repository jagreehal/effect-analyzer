# Service: Cache

## Definition

- **Class**: `Cache`
- **File**: `packages/effect-analyzer/src/__fixtures__/real-world-patterns.ts:54`
- **Tag**: `'Cache'`
- **Type**: `{
    readonly get: (key: string) => Effect.Effect<Option.Option<unknown>>;
    readonly set: (key: string, value: unknown, ttl?: number) => Effect.Effect<void>;
    readonly delete: (key: string) => Effect.Effect<void>;
  }`

## Interface

**Methods:**
- `get`
- `set`
- `delete`
