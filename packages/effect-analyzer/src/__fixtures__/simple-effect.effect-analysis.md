# Effect Analysis: simpleProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/simple-effect.ts`
- **Analyzed**: 2026-05-22T16:10:34.438Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: simpleProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["value <- succeed"]
  n4["log (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  start --> n2
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
simpleProgram (generator):
  1. Calls log
  2. Yields value <- succeed
  3. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: programWithErrorHandling

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/simple-effect.ts`
- **Analyzed**: 2026-05-22T16:10:34.441Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: programWithErrorHandling

  start((Start))
  end_node((End))

  n2["result <- tryPromise (side-effect)"]
  n3["catchAll (error-handler)"]
  n4["Effect"]
  err_handler_5["catchAll"]
  n6["succeed"]

  %% Edges
  n4 -->|on error| err_handler_5
  err_handler_5 --> n6
  n2 --> n4
  start --> n2
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 errorHandlerStyle
  class n4 effectStyle
  class err_handler_5 errorHandlerStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Error Handlers**: 1


## Explanation

```
programWithErrorHandling (generator):
  1. Yields result <- tryPromise

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`

