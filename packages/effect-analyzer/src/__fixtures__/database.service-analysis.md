# Service: Database

## Definition

- **Class**: `Database`
- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts:20`
- **Tag**: `'Database'`
- **Type**: `{
    readonly query: (sql: string) => Effect.Effect<unknown[], DatabaseError>;
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | DatabaseError, R>;
  }`

## Interface

**Methods:**
- `query`
- `transaction`
