---
'effect-analyzer': patch
---

Import Starlight's `Icon` from `@astrojs/starlight/components` in the docs app's
theme provider. The previous relative path into `node_modules` pointed at a file
Starlight 0.42 no longer ships there, which broke the documentation build.
