# Effect Analysis: pipeHeavyProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/pipe-heavy.ts`
- **Analyzed**: 2026-05-22T16:10:33.388Z
- **Source Type**: pipe
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: pipeHeavyProgram

  start((Start))
  end_node((End))

  n1["Pipe (6 steps)"]
  n2["succeed"]
  n3["tap (transform)"]
  n4["map (transform)"]
  n5["flatMap (transform)"]
  n6["tap (transform)"]
  n7["catchAll (error-handler)"]
  n8["Effect"]
  err_handler_9["catchAll"]
  n10["succeed"]
  n11["map (transform)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n8 -->|on error| err_handler_9
  err_handler_9 --> n10
  n6 --> n8
  n10 --> n11
  n1 --> n2
  start --> n1
  n11 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
  class n3 transformStyle
  class n4 transformStyle
  class n5 transformStyle
  class n6 transformStyle
  class n7 errorHandlerStyle
  class n8 effectStyle
  class err_handler_9 errorHandlerStyle
  class n10 effectStyle
  class n11 transformStyle
```


## Statistics

- **Total Effects**: 8
- **Error Handlers**: 1


## Explanation

```
pipeHeavyProgram (pipe):
  1. Pipes succeed through:
    Calls succeed — constructor
    Transforms via tap
    Transforms via map
    Transforms via flatMap
    Transforms via tap
    Catches all errors on:
      Calls Effect
      Handler:
        Calls succeed — constructor
    Transforms via map

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: base

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/pipe-heavy.ts`
- **Analyzed**: 2026-05-22T16:10:33.388Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: base

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
base (direct):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```

