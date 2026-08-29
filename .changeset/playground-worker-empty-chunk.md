---
'effect-analyzer': patch
---

Stop `output/html.ts` from splicing a regex across template-literal boundaries,
which made rolldown emit an empty chunk.

To embed a literal `${` in the generated viewer script, the source closed the
template literal and concatenated:

```
q.replace(/[.*+?^$` + `{}()|\\[\\]\\\\]/g, '\\\\$` + `&')
```

Bundling that through rolldown — Vite 8's bundler — produces a **zero-byte**
chunk for whatever entry pulls in `renderInteractiveHTML`. No error, no warning:
the build succeeds and the output is empty. Escaping the dollar as `\${` keeps
the template intact and bundles normally. The second splice was never needed,
because `$&` is not `${`.

The rendered HTML is byte-identical before and after, so this changes nothing
about the viewer — it only makes the module survive a rolldown-based bundler.
Anyone bundling `renderInteractiveHTML` with Vite 8 would otherwise get an entry
that silently does nothing.

This is what took down the docs playground, whose analysis runs in a module
worker: an empty worker chunk still serves as `200 application/javascript`, and
an empty module is a valid module, so it loads without firing `error`, registers
no `message` listener, and never replies. The page waited on "Analyzing in
worker..." indefinitely.
