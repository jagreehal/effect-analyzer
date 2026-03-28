---
"effect-analyzer": patch
"effect-analyzer-docs": patch
---

fix: interactive HTML viewer theme switching and playground improvements

- Fix mermaid "Syntax error in text" when changing themes in the interactive HTML viewer — the diagram source text is now restored before re-rendering
- Eliminate green flash on initial load by using MutationObserver to retheme SVG nodes immediately after mermaid renders, with CSS visibility gate to prevent any flash of default classDef colors
- Replace arbitrary setTimeout delays (500ms/1000ms) with deterministic observer-based timing
- Make sidebar responsive with minmax(260px, 380px) instead of fixed 380px
- Add breadcrumb navigation bar to the standalone playground page
- Add "Full page" button to open the interactive viewer in a new browser tab
- Add favicon to the standalone playground page
- Add debounced auto-analyze (1.5s) on textarea input with proper empty/error/success states
- Add Playground link to README nav
- Regenerate transfer-analysis.html demo with fixed theme switching code
- Rewrite Semantic Diff docs with a worked example framed as reviewing an AI agent's PR, including real before/after code, railway diagrams, actual diff output, and CI regression detection patterns
