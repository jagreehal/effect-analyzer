---
'effect-analyzer': patch
---

Fix `Schema.Struct` with an array field being converted to an array instead of
an object in `api-docs` / `openapi-paths` output.

The Effect Schema → JSON Schema walker dispatched on
`node.getText().includes('Schema.Array')`, which matches anything nested in the
arguments too, so `Schema.Struct({ tags: Schema.Array(Schema.String) })` was
read as an array of arrays and lost every property. Dispatch now reads the
construct's own callee, so a nested `Schema.Array` no longer captures its
parent. The same bug applied to `Schema.Union` with an array member.
