---
'effect-analyzer': patch
---

Remove dead plumbing from the Effect Schema → JSON Schema converter, found by
mutation testing.

`WalkContext` carried `sf`, `project` and a `defs` map through every construct
in the dispatch table. Nothing ever read them, and no caller ever passed `defs`.
Both are gone, along with `schemaToJsonSchema`'s `sf` and `project` parameters.

`resolveSchemaNode` had two branches that cannot run: an import-specifier walk
that `getAliasedSymbol()` already subsumes, and a same-file fallback search
reached only when symbol resolution has already failed, in which case the search
fails too. 56 lines become 15.

Coverage of the module went from a 29% mutation score to 95%: every entry in the
construct table now has a test, including the ones that were silently returning
`undefined`.
