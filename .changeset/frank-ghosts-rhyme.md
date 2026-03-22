---
"effect-analyzer": patch
---

Add `repository`, `bugs`, and `homepage` to package metadata so npm provenance and OIDC trusted publishing can validate the source repo.

Resolve `@typescript-eslint/require-await` in the CLI (`Effect.tryPromise` no longer uses an `async` callback without `await`) and in a couple of tests that did not need `async`.
