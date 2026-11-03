# Effect Analysis: internalAliasProgram

## Metadata

- **File**: `packages/effect-analyzer/src/__fixtures__/internal/alias.ts`
- **Analyzed**: 2026-05-22T16:10:32.571Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: internalAliasProgram

  start((Start))
  end_node((End))

  n1["succeed"]

  %% Edges
  start --> n1
  n1 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
internalAliasProgram (direct):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```

