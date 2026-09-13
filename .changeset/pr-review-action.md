---
'effect-analyzer': minor
---

Add `effect-analyze review` and a GitHub Action around it. `review --base <ref>` reads the change from git, diffs every Effect program it touched structurally, keeps only the lint findings the change introduced, and renders a PR-comment-ready report: merge-risk verdict, walkthrough and checks tables, a railway diagram per changed program, and a prompt block for AI agents. `--format json` carries the same data plus the markdown; `--fail-on-regression` exits 1 on high risk. `uses: jagreehal/effect-analyzer@v3` posts it as one sticky PR comment, writes the job summary, and annotates new findings inline.

Single-file analysis now writes the adjacent `.effect-analysis.md` by default (`--no-colocate` to print only), linear programs are colocated as railway, `Effect.runPromise` entrypoints are treated as trivial, and railway steps are labelled with the callee and TaggedError `_tag` (`FETCH_ERROR`).
