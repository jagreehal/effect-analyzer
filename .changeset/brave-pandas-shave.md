---
'effect-analyzer': patch
---

`--version`/`-v` prints the analyzer version, and an unrecognized flag is
reported as an error.

Mermaid node labels collapse whitespace runs to a single space, so a label built
from wrapped source stays on one line.

`--assert-diagram-fidelity` requires at least one program to check.

`analyze().single` names the programs it found and points at `.named()` and
`.all`. `effect-analyzer/package.json` is exported, and the `effect` peer range
moves to `^4.0.0-rc.112`.
