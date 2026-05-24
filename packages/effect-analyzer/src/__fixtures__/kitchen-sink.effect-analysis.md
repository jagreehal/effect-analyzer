# Effect Analysis: genWithServices

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.657Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: genWithServices

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["config <- Config (environment)"]
  n4["logger.info (side-effect)"]
  n5["v <- config.get (side-effect)"]
  n6["log (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  start --> n2
  n6 --> end_node

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
```


## Statistics

- **Total Effects**: 5


## Explanation

```
genWithServices (generator):
  1. Yields logger <- Logger
  2. Yields config <- Config
  3. Calls logger.info
  4. Yields v <- config.get
  5. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: parallelProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.662Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: parallelProgram

  start((Start))
  end_node((End))

  n2["a <- succeed"]
  n3["Effect.all (3) (concurrency)"]
  parallel_fork_4{{"All (3)"}}
  parallel_join_4{{"Join"}}
  n5["succeed"]
  n6["succeed"]
  n7["succeed"]

  %% Edges
  n3 --> parallel_fork_4
  parallel_fork_4 -->|succeed| n5
  n5 --> parallel_join_4
  parallel_fork_4 -->|succeed| n6
  n6 --> parallel_join_4
  parallel_fork_4 -->|succeed| n7
  n7 --> parallel_join_4
  n2 --> n3
  start --> n2
  parallel_join_4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef parallelStyle fill:#FFA500,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 parallelStyle
  class parallel_fork_4 parallelStyle
  class parallel_join_4 parallelStyle
  class n5 effectStyle
  class n6 effectStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Parallel Operations**: 1


## Explanation

```
parallelProgram (generator):
  1. Yields a <- succeed
  2. [x, y, z] = Runs 3 effects in sequential:
    Calls succeed — constructor
    Calls succeed — constructor
    Calls succeed — constructor

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: raceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.663Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: raceProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["Effect.race (2 racing) (concurrency)"]
  race_fork_5{{{"Race (2)"}}}
  race_join_5{{{"Winner"}}}
  n6["succeed"]
  n7["succeed"]

  %% Edges
  n4 --> race_fork_5
  race_fork_5 -->|succeed| n6
  n6 --> race_join_5
  race_fork_5 -->|succeed| n7
  n7 --> race_join_5
  n2 --> n4
  race_join_5 --> term_3
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef raceStyle fill:#FF6347,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 raceStyle
  class race_fork_5 raceStyle
  class race_join_5 raceStyle
  class n6 effectStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Race Operations**: 1


## Explanation

```
raceProgram (generator):
  1. Returns:
    Races 2 effects:
      Calls succeed — constructor
      Calls succeed — constructor

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: streamProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.666Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: streamProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["Stream → runCollect → runCollect (stream)"]
  n5["stream"]
  n6["Stream → fromIterable → map (stream)"]
  n7["Unknown: Could not determine effect type"]
  n8["Stream → fromIterable (stream)"]
  n9["Unknown: Could not determine effect type"]
  n10["Stream → map (stream)"]
  n11["Unknown: Could not determine effect type"]

  %% Edges
  n4 --> n5
  n2 --> n4
  n5 --> term_3
  n6 --> n7
  n8 --> n9
  n7 --> n8
  n10 --> n11
  n9 --> n10
  start --> n2
  n11 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef streamStyle fill:#E0F7FA,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 streamStyle
  class n5 effectStyle
  class n6 streamStyle
  class n7 unknownStyle
  class n8 streamStyle
  class n9 unknownStyle
  class n10 streamStyle
  class n11 unknownStyle
```


## Statistics

- **Total Effects**: 1
- **Unknown Nodes**: 4


## Explanation

```
streamProgram (generator):
  1. Returns:
    Stream: runCollect -> runCollect
      Calls stream
  2. Stream: fromIterable -> map
    (unknown: Could not determine effect type)
    map callback:
      Calls n * 2 — callback-transform
  3. Stream: fromIterable
    (unknown: Could not determine effect type)
  4. Stream: map
    (unknown: Could not determine effect type)
    map callback:
      Calls n * 2 — callback-transform

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: schemaProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.681Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: schemaProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["decode (side-effect)"]

  %% Edges
  n2 --> n4
  n4 --> term_3
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
schemaProgram (generator):
  1. Returns:
    Calls decode — schema

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: errorHandlingProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.682Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: errorHandlingProgram

  start((Start))
  end_node((End))

  n1["retry: Schedule.recurs(2) (scheduling)"]
  n4["return"]
  term_5(["return"])
  n6["fail"]
  n7["catchTag (error-handler)"]
  n8["Effect"]
  err_handler_9["catchTag"]
  n10["Unknown: Could not determine effect type"]
  retry_11["Retry(Schedule.recurs(2))"]
  n12["timeout: '10 seconds' (scheduling)"]
  n13["Effect"]
  timeout_14["Timeout('10 seconds')"]

  %% Edges
  n4 --> n6
  n6 --> term_5
  n8 -->|on Bad| err_handler_9
  err_handler_9 --> n10
  n4 --> n8
  n10 --> retry_11
  n13 --> timeout_14
  retry_11 --> n13
  start --> n4
  timeout_14 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef retryStyle fill:#EE82EE,stroke:#333,stroke-width:2px
  classDef timeoutStyle fill:#87CEEB,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 retryStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 effectStyle
  class n7 errorHandlerStyle
  class n8 effectStyle
  class err_handler_9 errorHandlerStyle
  class n10 unknownStyle
  class retry_11 retryStyle
  class n12 timeoutStyle
  class n13 effectStyle
  class timeout_14 timeoutStyle
```


## Statistics

- **Total Effects**: 3
- **Error Handlers**: 1
- **Retry Operations**: 1
- **Timeout Operations**: 1
- **Unknown Nodes**: 1


## Explanation

```
errorHandlingProgram (generator):
  1. Retries with Schedule.recurs(2):
    Returns:
      Calls fail — constructor
    Catches tag "Bad" on:
      Calls Effect
      Handler:
        (unknown: Could not determine effect type)
  2. Times out after '10 seconds':
    Calls Effect

  Error paths: { _tag: "Bad"; }
  Concurrency: sequential (no parallelism)
```


## Error Types

- `{ _tag: "Bad"; }`



---

# Effect Analysis: fiberProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.688Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: fiberProgram

  start((Start))
  end_node((End))

  n2["fork (fiber)"]
  n3["succeed <number, never, never>"]
  n4["return"]
  term_5(["return"])
  n6["join (fiber)"]

  %% Edges
  n2 --> n3
  n4 --> n6
  n6 --> term_5
  n3 --> n4
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef fiberStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 fiberStyle
  class n3 effectStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 fiberStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
fiberProgram (generator):
  1. fiber = Fiber fork:
    Calls succeed — constructor
  2. Returns:
    Fiber join:

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: scopedProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.690Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: scopedProgram

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["Pipe (1 steps)"]
  n5["Resource (resource)"]
  n6["succeed"]
  resource_7["Resource"]
  n8["Effect.scoped"]

  %% Edges
  n6 --> resource_7
  resource_7 --> n8
  n4 --> n6
  n2 --> n4
  n8 --> term_3
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef resourceStyle fill:#98FB98,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 terminalStyle
  class term_3 terminalStyle
  class n4 pipeStyle
  class n5 resourceStyle
  class n6 effectStyle
  class resource_7 resourceStyle
  class n8 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Resources**: 1


## Explanation

```
scopedProgram (generator):
  1. Returns:
    Pipes acquireRelease through:
      Acquires resource:
        Calls succeed — constructor
        Then releases:
          Calls Effect.void
      Calls Effect.scoped

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: LoggerLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.692Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: LoggerLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["Logger"]
  n3["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n3
  n1 --> n2
  start --> n1
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef layerStyle fill:#E6E6FA,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 layerStyle
  class n2 effectStyle
  class n3 unknownStyle
```


## Statistics

- **Total Effects**: 1
- **Unknown Nodes**: 1


## Explanation

```
LoggerLive (direct):
  1. Provides layer providing Logger:
    Calls Logger
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ConfigLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.693Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ConfigLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["Config"]
  n3["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n3
  n1 --> n2
  start --> n1
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef layerStyle fill:#E6E6FA,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 layerStyle
  class n2 effectStyle
  class n3 unknownStyle
```


## Statistics

- **Total Effects**: 1
- **Unknown Nodes**: 1


## Explanation

```
ConfigLive (direct):
  1. Provides layer providing Config:
    Calls Config
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: AppLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.694Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AppLayer

  start((Start))
  end_node((End))

  n1["LoggerLive.pipe (service-call)"]

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
AppLayer (direct):
  1. Calls Layer.pipe — service-call

  Services required: Layer
  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.696Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserSchema

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
UserSchema (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: resourceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.698Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: resourceProgram

  start((Start))
  end_node((End))

  n1["Pipe (1 steps)"]
  n2["Resource (resource)"]
  n3["sync (side-effect)"]
  resource_4["Resource"]
  n5["flatMap (transform)"]

  %% Edges
  n3 --> resource_4
  resource_4 --> n5
  n1 --> n3
  start --> n1
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef resourceStyle fill:#98FB98,stroke:#333,stroke-width:2px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 resourceStyle
  class n3 effectStyle
  class resource_4 resourceStyle
  class n5 transformStyle
```


## Statistics

- **Total Effects**: 3
- **Resources**: 1


## Explanation

```
resourceProgram (direct):
  1. Pipes acquireRelease through:
    Acquires resource:
      Calls sync — constructor
      Then releases:
        Calls sync — constructor
    Transforms via flatMap

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: conditionalProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.699Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: conditionalProgram

  start((Start))
  end_node((End))

  n1["flag (control-flow)"]
  cond_2{"flag"}
  n3["succeed"]
  n4["succeed"]

  %% Edges
  n1 --> cond_2
  cond_2 -->|true| n3
  cond_2 -->|false| n4
  start --> n1
  n3 --> end_node
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 conditionalStyle
  class cond_2 conditionalStyle
  class n3 effectStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Conditionals**: 1


## Explanation

```
conditionalProgram (direct):
  1. If flag:
    Calls succeed — constructor
  2. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: loopProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.701Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: loopProgram

  start((Start))
  end_node((End))

  n1["forEach((1, 2, 3)) (control-flow)"]
  loop_2(["forEach((1, 2, 3))"])
  n3["log (side-effect)"]

  %% Edges
  n1 --> loop_2
  loop_2 -->|iterate| n3
  n3 -->|next| loop_2
  start --> n1
  loop_2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 loopStyle
  class loop_2 loopStyle
  class n3 effectStyle
```


## Statistics

- **Loops**: 1


## Explanation

```
loopProgram (direct):
  1. Iterates (forEach) over [1, 2, 3]:
    Calls log — callback-call
    Callback:
      Calls log — callback-call

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: pipeChainProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.704Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: pipeChainProgram

  start((Start))
  end_node((End))

  n1["Pipe (3 steps)"]
  n2["succeed"]
  n3["map (transform)"]
  n4["flatMap (transform)"]
  n5["tap (transform)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n1 --> n2
  start --> n1
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
  class n3 transformStyle
  class n4 transformStyle
  class n5 transformStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
pipeChainProgram (direct):
  1. Pipes succeed through:
    Calls succeed — constructor
    Transforms via map
    Transforms via flatMap
    Transforms via tap

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: Logger

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.704Z
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



---

# Effect Analysis: Config

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/kitchen-sink.ts`
- **Analyzed**: 2026-05-22T16:10:32.704Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: Config

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
Config (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```

