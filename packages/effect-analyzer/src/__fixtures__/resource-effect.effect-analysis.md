# Effect Analysis: resourceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/resource-effect.ts`
- **Analyzed**: 2026-05-22T16:10:34.013Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: resourceProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]

  %% Edges
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
resourceProgram (generator):
  1. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ensuringProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/resource-effect.ts`
- **Analyzed**: 2026-05-22T16:10:34.018Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ensuringProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["return"]
  term_4(["return"])
  n5["succeed"]
  n6["Resource (resource)"]
  n7["Effect"]
  resource_8["Resource"]

  %% Edges
  n3 --> n5
  n5 --> term_4
  n2 --> n3
  n7 --> resource_8
  n2 --> n7
  start --> n2
  resource_8 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef resourceStyle fill:#98FB98,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 terminalStyle
  class term_4 terminalStyle
  class n5 effectStyle
  class n6 resourceStyle
  class n7 effectStyle
  class resource_8 resourceStyle
```


## Statistics

- **Total Effects**: 4
- **Resources**: 1


## Explanation

```
ensuringProgram (generator):
  1. Calls log
  2. Returns:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: syncWithInnerEffect

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/resource-effect.ts`
- **Analyzed**: 2026-05-22T16:10:34.018Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: syncWithInnerEffect

  start((Start))
  end_node((End))

  n1["sync (side-effect)"]

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

- **Total Effects**: 2


## Explanation

```
syncWithInnerEffect (direct):
  1. Calls sync — constructor
    Callback:
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```

