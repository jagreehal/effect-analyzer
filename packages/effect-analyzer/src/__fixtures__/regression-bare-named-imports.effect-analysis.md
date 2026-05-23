# Effect Analysis: directProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/regression-bare-named-imports.ts`
- **Analyzed**: 2026-05-22T16:10:33.788Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: directProgram

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
directProgram (direct):
  1. Calls succeed

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: awaitedProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/regression-bare-named-imports.ts`
- **Analyzed**: 2026-05-22T16:10:33.789Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: awaitedProgram

  start((Start))
  end_node((End))

  n1["Unknown: Could not determine effect type"]

  %% Edges
  start --> n1
  n1 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 unknownStyle
```


## Statistics

- **Unknown Nodes**: 1


## Explanation

```
awaitedProgram (direct):
  1. (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```

