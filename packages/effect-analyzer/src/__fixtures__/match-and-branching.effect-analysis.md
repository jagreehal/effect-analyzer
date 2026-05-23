# Effect Analysis: branchingGenProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/match-and-branching.ts`
- **Analyzed**: 2026-05-22T16:10:33.068Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: branchingGenProgram

  start((Start))
  end_node((End))

  n2["result <- matchEffectProgram (side-effect)"]
  decision_4{"result.status === 'ok'"}
  n5["log (side-effect)"]
  n6["log (side-effect)"]

  %% Edges
  decision_4 -->|yes| n5
  decision_4 -->|no| n6
  n2 --> decision_4
  start --> n2
  n5 --> end_node
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class decision_4 decisionStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
branchingGenProgram (generator):
  1. Yields result <- matchEffectProgram
  2. If result.status === 'ok':
    Calls log
  3. Else:
    Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: fetchMaybeUser

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/match-and-branching.ts`
- **Analyzed**: 2026-05-22T16:10:33.069Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: fetchMaybeUser

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
fetchMaybeUser (direct):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: matchProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/match-and-branching.ts`
- **Analyzed**: 2026-05-22T16:10:33.070Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: matchProgram

  start((Start))
  end_node((End))

  n1["Pipe (2 steps)"]
  n2["fetchMaybeUser (side-effect)"]
  n3["flatMap (transform)"]
  n4["match (error-handler)"]
  n5["Effect"]
  err_handler_6["match"]
  n7["match-handlers (2 effects)"]
  parallel_fork_8{{"All (2)"}}
  parallel_join_8{{"Join"}}
  n9["Unknown: Could not determine effect type"]
  n10["user"]

  %% Edges
  n2 --> n3
  n5 -->|on error| err_handler_6
  n7 --> parallel_fork_8
  parallel_fork_8 -->|branch 1| n9
  n9 --> parallel_join_8
  parallel_fork_8 -->|branch 2| n10
  n10 --> parallel_join_8
  err_handler_6 --> n7
  n3 --> n5
  n1 --> n2
  start --> n1
  parallel_join_8 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef parallelStyle fill:#FFA500,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
  class n3 transformStyle
  class n4 errorHandlerStyle
  class n5 effectStyle
  class err_handler_6 errorHandlerStyle
  class n7 parallelStyle
  class parallel_fork_8 parallelStyle
  class parallel_join_8 parallelStyle
  class n9 unknownStyle
  class n10 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 1
- **Unknown Nodes**: 1


## Explanation

```
matchProgram (direct):
  1. Pipes fetchMaybeUser through:
    Calls fetchMaybeUser
    Transforms via flatMap
    Handles errors (match):
      Calls Effect
      Handler:
        Runs 2 effects in sequential:
          (unknown: Could not determine effect type)
          Calls user

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: matchEffectProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/match-and-branching.ts`
- **Analyzed**: 2026-05-22T16:10:33.071Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: matchEffectProgram

  start((Start))
  end_node((End))

  n1["Pipe (1 steps)"]
  n2["matchProgram (side-effect)"]
  n3["matchEffect (error-handler)"]
  n4["Effect"]
  err_handler_5["matchEffect"]
  n6["match-handlers (2 effects)"]
  parallel_fork_7{{"All (2)"}}
  parallel_join_7{{"Join"}}
  n8["succeed"]
  n9["succeed"]

  %% Edges
  n4 -->|on error| err_handler_5
  n6 --> parallel_fork_7
  parallel_fork_7 -->|branch 1| n8
  n8 --> parallel_join_7
  parallel_fork_7 -->|branch 2| n9
  n9 --> parallel_join_7
  err_handler_5 --> n6
  n2 --> n4
  n1 --> n2
  start --> n1
  parallel_join_7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef parallelStyle fill:#FFA500,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
  class n3 errorHandlerStyle
  class n4 effectStyle
  class err_handler_5 errorHandlerStyle
  class n6 parallelStyle
  class parallel_fork_7 parallelStyle
  class parallel_join_7 parallelStyle
  class n8 effectStyle
  class n9 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 1


## Explanation

```
matchEffectProgram (direct):
  1. Pipes matchProgram through:
    Calls matchProgram
    Handles errors (matchEffect):
      Calls Effect
      Handler:
        Runs 2 effects in sequential:
          Calls succeed — constructor
          Calls succeed — constructor

  Concurrency: uses parallelism / racing
```

