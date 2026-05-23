# Effect Analysis: catchAllProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.355Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: catchAllProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["return"]
  term_4(["return"])
  n5["fail"]
  n6["catchAll (error-handler)"]
  n7["Effect"]
  err_handler_8["catchAll"]
  n9["succeed"]

  %% Edges
  n3 --> n5
  n5 --> term_4
  n2 --> n3
  n7 -->|on error| err_handler_8
  err_handler_8 --> n9
  n2 --> n7
  start --> n2
  n9 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 terminalStyle
  class term_4 terminalStyle
  class n5 effectStyle
  class n6 errorHandlerStyle
  class n7 effectStyle
  class err_handler_8 errorHandlerStyle
  class n9 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 1


## Explanation

```
catchAllProgram (generator):
  1. Calls log
  2. Returns:
    Calls fail — constructor

  Error paths: string
  Concurrency: sequential (no parallelism)
```


## Error Types

- `string`



---

# Effect Analysis: catchTagProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.356Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: catchTagProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["fail"]
  n5["catchTag (error-handler)"]
  n6["Effect"]
  err_handler_7["catchTag"]
  n8["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n4
  n4 --> term_3
  n6 -->|on NotFound| err_handler_7
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
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 effectStyle
  class n5 errorHandlerStyle
  class n6 effectStyle
  class err_handler_7 errorHandlerStyle
  class n8 unknownStyle
```


## Statistics

- **Total Effects**: 2
- **Error Handlers**: 1
- **Unknown Nodes**: 1


## Explanation

```
catchTagProgram (generator):
  1. Returns:
    Calls fail — constructor

  Error paths: { _tag: "NotFound"; }
  Concurrency: sequential (no parallelism)
```


## Error Types

- `{ _tag: "NotFound"; }`



---

# Effect Analysis: retryProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.358Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: retryProgram

  start((Start))
  end_node((End))

  n1["retry: Schedule.recurs(3) (scheduling)"]
  n3["log (side-effect)"]
  n4["return"]
  term_5(["return"])
  n6["succeed"]
  retry_7["Retry(Schedule.recurs(3))"]

  %% Edges
  n4 --> n6
  n6 --> term_5
  n3 --> n4
  n3 --> retry_7
  start --> n3
  retry_7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef retryStyle fill:#EE82EE,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 retryStyle
  class n3 effectStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 effectStyle
  class retry_7 retryStyle
```


## Statistics

- **Total Effects**: 2
- **Retry Operations**: 1


## Explanation

```
retryProgram (generator):
  1. Retries with Schedule.recurs(3):
    Calls log
    Returns:
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: timeoutProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.359Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: timeoutProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["sleep (side-effect)"]
  n5["timeout: '5 seconds' (scheduling)"]
  n6["Effect"]
  timeout_7["Timeout('5 seconds')"]

  %% Edges
  n2 --> n4
  n4 --> term_3
  n6 --> timeout_7
  n2 --> n6
  start --> n2
  timeout_7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef timeoutStyle fill:#87CEEB,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 effectStyle
  class n5 timeoutStyle
  class n6 effectStyle
  class timeout_7 timeoutStyle
```


## Statistics

- **Total Effects**: 2
- **Timeout Operations**: 1


## Explanation

```
timeoutProgram (generator):
  1. Returns:
    Calls sleep

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: orElseProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.360Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: orElseProgram

  start((Start))
  end_node((End))

  n1["Pipe (1 steps)"]
  n2["fail"]
  n3["orElse (error-handler)"]
  n4["Effect"]
  err_handler_5["orElse"]
  n6["succeed"]

  %% Edges
  n4 -->|on error| err_handler_5
  err_handler_5 --> n6
  n2 --> n4
  n1 --> n2
  start --> n1
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
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
orElseProgram (direct):
  1. Pipes fail through:
    Calls fail — constructor
    Falls back (orElse) on error:
      Calls Effect
      Handler:
        Calls succeed — constructor

  Error paths: string
  Concurrency: sequential (no parallelism)
```


## Error Types

- `string`



---

# Effect Analysis: orDieProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/error-handling.ts`
- **Analyzed**: 2026-05-22T16:10:32.361Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: orDieProgram

  start((Start))
  end_node((End))

  n1["Pipe (1 steps)"]
  n2["succeed"]
  n3["Effect.orDie"]

  %% Edges
  n2 --> n3
  n1 --> n2
  start --> n1
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
orDieProgram (direct):
  1. Pipes succeed through:
    Calls succeed — constructor
    Calls Effect.orDie

  Concurrency: sequential (no parallelism)
```

