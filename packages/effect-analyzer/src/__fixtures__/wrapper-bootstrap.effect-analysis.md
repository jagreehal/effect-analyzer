# Effect Analysis: program

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/wrapper-bootstrap.ts`
- **Analyzed**: 2026-05-22T16:10:34.937Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: program

  start((Start))
  end_node((End))

  n2["succeed"]

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
program (generator):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: AppLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/wrapper-bootstrap.ts`
- **Analyzed**: 2026-05-22T16:10:34.939Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AppLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["Unknown: Could not determine effect type"]
  n3["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n3
  n1 --> n2
  start --> n1
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef layerStyle fill:#E6E6FA,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 layerStyle
  class n2 unknownStyle
  class n3 unknownStyle
```


## Statistics

- **Unknown Nodes**: 2


## Explanation

```
AppLive (direct):
  1. Provides layer:
    (unknown: Could not determine effect type)
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: runApp

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/wrapper-bootstrap.ts`
- **Analyzed**: 2026-05-22T16:10:34.939Z
- **Source Type**: run
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: runApp

  start((Start))
  end_node((End))

  n1["AppLive"]

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
runApp (run):
  1. Calls AppLive

  Concurrency: sequential (no parallelism)
```

