# Effect Analysis: richProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts`
- **Analyzed**: 2026-05-22T16:10:34.111Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: richProgram

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["repo <- UserRepo (environment)"]
  n4["logger.info (side-effect)"]
  n5["user <- repo.getById (service-call)"]
  n6["log (side-effect)"]
  n7["catchTag (error-handler)"]
  n8["Effect"]
  err_handler_9["catchTag"]
  n10["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n8 -->|on NotFound| err_handler_9
  err_handler_9 --> n10
  n6 --> n8
  start --> n2
  n10 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class n4 effectStyle
  class n5 effectStyle
  class n6 effectStyle
  class n7 errorHandlerStyle
  class n8 effectStyle
  class err_handler_9 errorHandlerStyle
  class n10 unknownStyle
```


## Statistics

- **Total Effects**: 6
- **Error Handlers**: 1
- **Unknown Nodes**: 1


## Explanation

```
richProgram (generator):
  1. Yields logger <- Logger
  2. Yields repo <- UserRepo
  3. Calls logger.info
  4. Yields user <- repo.getById
  5. Calls log

  Services required: UserRepo
  Error paths: { _tag: "NotFound"; }
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `UserRepo`


## Error Types

- `{ _tag: "NotFound"; }`



---

# Effect Analysis: parallelProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts`
- **Analyzed**: 2026-05-22T16:10:34.116Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: parallelProgram

  start((Start))
  end_node((End))

  n2["Effect.all (2) (concurrency)"]
  parallel_fork_3{{"All (2)"}}
  parallel_join_3{{"Join"}}
  n4["succeed"]
  n5["succeed"]

  %% Edges
  n2 --> parallel_fork_3
  parallel_fork_3 -->|succeed| n4
  n4 --> parallel_join_3
  parallel_fork_3 -->|succeed| n5
  n5 --> parallel_join_3
  start --> n2
  parallel_join_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef parallelStyle fill:#FFA500,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 parallelStyle
  class parallel_fork_3 parallelStyle
  class parallel_join_3 parallelStyle
  class n4 effectStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Parallel Operations**: 1


## Explanation

```
parallelProgram (generator):
  1. [a, b] = Runs 2 effects in sequential:
    Calls succeed — constructor
    Calls succeed — constructor

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: conditionalProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts`
- **Analyzed**: 2026-05-22T16:10:34.117Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: conditionalProgram

  start((Start))
  end_node((End))

  n2["value <- succeed"]
  n3["value (control-flow)"]
  cond_4{"value"}
  n5["log (side-effect)"]
  n6["log (side-effect)"]

  %% Edges
  n3 --> cond_4
  cond_4 -->|true| n5
  cond_4 -->|false| n6
  n2 --> n3
  start --> n2
  n5 --> end_node
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 conditionalStyle
  class cond_4 conditionalStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Conditionals**: 1


## Explanation

```
conditionalProgram (generator):
  1. Yields value <- succeed
  2. If value:
    Calls log
  3. Else:
    Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserRepo

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts`
- **Analyzed**: 2026-05-22T16:10:34.118Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserRepo

  start((Start))
  end_node((End))

  n1["Context.Tag"]

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
UserRepo (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: Logger

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rich-labels.ts`
- **Analyzed**: 2026-05-22T16:10:34.118Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: Logger

  start((Start))
  end_node((End))

  n1["Context.Tag"]

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
Logger (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```

