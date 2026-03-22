# effect-analyzer

## 0.1.2

### Patch Changes

- 9ea3234: Add `repository`, `bugs`, and `homepage` to package metadata so npm provenance and OIDC trusted publishing can validate the source repo.

  Resolve `@typescript-eslint/require-await` in the CLI (`Effect.tryPromise` no longer uses an `async` callback without `await`) and in a couple of tests that did not need `async`.

## 0.1.1

### Patch Changes

- f68fa1a: Tighten `Effect.gen` call detection: require the callee to end with `.gen` instead of matching `.gen` anywhere in the expression text, so unrelated identifiers are not mistaken for `gen` programs.
