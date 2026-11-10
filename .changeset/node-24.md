---
"effect-analyzer": major
"effect-analyzer-docs": patch
---

Require Node 24 or newer. The package declares `engines.node >=24` and the GitHub Action checks for Node 24. Move the Action to `jagreehal/effect-analyzer@v4`, which runs `effect-analyzer@4`. The workflow examples use `node-version: 24` with the Node 24 releases of `actions/checkout`, `actions/setup-node`, `pnpm/action-setup` and `github/codeql-action`.
