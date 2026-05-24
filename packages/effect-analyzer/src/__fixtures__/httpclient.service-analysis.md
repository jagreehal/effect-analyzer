# Service: HttpClient

## Definition

- **Class**: `HttpClient`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/real-world-patterns.ts:41`
- **Tag**: `'HttpClient'`
- **Type**: `{
    readonly get: <A>(url: string) => Effect.Effect<A, HttpError>;
    readonly post: <A>(url: string, body: unknown) => Effect.Effect<A, HttpError>;
    readonly put: <A>(url: string, body: unknown) => Effect.Effect<A, HttpError>;
    readonly delete: (url: string) => Effect.Effect<void, HttpError>;
  }`

## Interface

**Methods:**
- `get`
- `post`
- `put`
- `delete`
