# Service: Fixtures/UserRepo

## Definition

- **Class**: `UserRepo`
- **File**: `packages/effect-analyzer/src/__fixtures__/services.ts:18`
- **Tag**: `'Fixtures/UserRepo'`
- **Type**: `{
    readonly getUser: (id: string) => Effect.Effect<User, NotFound | RepoCrash>;
    readonly saveAudit: (message: string) => Effect.Effect<void>;
  }`

## Interface

**Methods:**
- `getUser`
- `saveAudit`
