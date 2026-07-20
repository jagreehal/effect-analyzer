# Effect Analysis: untaggedYieldProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.898Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: untaggedYieldProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["succeed"]

  %% Edges
  n2 --> n3
  start --> n2
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
untaggedYieldProgram (generator):
  1. Calls log
  2. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: missingHandlerProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.902Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: missingHandlerProgram

  start((Start))
  end_node((End))

  n2["result <- tryPromise (side-effect)"]

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
missingHandlerProgram (generator):
  1. Yields result <- tryPromise

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`



---

# Effect Analysis: deadCodeProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.903Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: deadCodeProgram

  start((Start))
  end_node((End))

  n2["_unused <- succeed"]
  n3["used <- succeed"]

  %% Edges
  n2 --> n3
  start --> n2
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
deadCodeProgram (generator):
  1. Yields _unused <- succeed
  2. Yields used <- succeed

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: complexLayerProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.908Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: complexLayerProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["provideService (side-effect)"]
  n4["provideService (side-effect)"]
  n5["provideService (side-effect)"]
  n6["provideService (side-effect)"]
  n7["provideService (side-effect)"]
  n8["provideService (side-effect)"]
  n9["provideService (side-effect)"]
  n10["provideService (side-effect)"]
  n11["provideService (side-effect)"]
  n12["provideService (side-effect)"]
  n13["provideService (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n7 --> n8
  n8 --> n9
  n9 --> n10
  n10 --> n11
  n11 --> n12
  n12 --> n13
  start --> n2
  n13 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class n4 effectStyle
  class n5 effectStyle
  class n6 effectStyle
  class n7 effectStyle
  class n8 effectStyle
  class n9 effectStyle
  class n10 effectStyle
  class n11 effectStyle
  class n12 effectStyle
  class n13 effectStyle
```


## Statistics

- **Total Effects**: 12


## Explanation

```
complexLayerProgram (generator):
  1. Calls log

  Error paths: E
  Concurrency: sequential (no parallelism)
```


## Error Types

- `E`



---

# Effect Analysis: catchProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.910Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: catchProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["fail"]
  n5["catch (error-handler)"]
  n6["Effect"]
  err_handler_7["catch"]
  n8["succeed"]

  %% Edges
  n2 --> n4
  n4 --> term_3
  n6 -->|on error| err_handler_7
  err_handler_7 --> n8
  n2 --> n6
  start --> n2
  n8 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 effectStyle
  class n5 errorHandlerStyle
  class n6 effectStyle
  class err_handler_7 errorHandlerStyle
  class n8 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Error Handlers**: 1


## Explanation

```
catchProgram (generator):
  1. Returns:
    Calls fail — constructor

  Error paths: { _tag: "NotFound"; message: string; }
  Concurrency: sequential (no parallelism)
```


## Error Types

- `{ _tag: "NotFound"; message: string; }`



---

# Effect Analysis: goodProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/lint-issues.ts`
- **Analyzed**: 2026-05-22T16:10:32.912Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: goodProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["result <- succeed"]
  n4["catch (error-handler)"]
  n5["Effect"]
  err_handler_6["catch"]
  n7["succeed"]

  %% Edges
  n2 --> n3
  n5 -->|on error| err_handler_6
  err_handler_6 --> n7
  n3 --> n5
  start --> n2
  n7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class n4 errorHandlerStyle
  class n5 effectStyle
  class err_handler_6 errorHandlerStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 1


## Explanation

```
goodProgram (generator):
  1. Calls log
  2. Yields result <- succeed

  Concurrency: sequential (no parallelism)
```

