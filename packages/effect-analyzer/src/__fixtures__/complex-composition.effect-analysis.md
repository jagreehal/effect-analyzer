# Effect Analysis: conditionalWhenProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.127Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: conditionalWhenProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["Pipe (1 steps)"]
  n4["succeed"]
  n5["() => shouldRun (control-flow)"]
  cond_6{"() => shouldRun"}
  n7["Effect"]

  %% Edges
  n5 --> cond_6
  cond_6 -->|true| n7
  n4 --> n5
  n3 --> n4
  n2 --> n3
  start --> n2
  n7 --> end_node
  cond_6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 pipeStyle
  class n4 effectStyle
  class n5 conditionalStyle
  class cond_6 conditionalStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Conditionals**: 1


## Explanation

```
conditionalWhenProgram (generator):
  1. Calls log
  2. result = Pipes succeed through:
    Calls succeed — constructor
    If () => shouldRun:
      Calls Effect

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: conditionalUnlessProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.130Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: conditionalUnlessProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["Pipe (1 steps)"]
  n4["succeed"]
  n5["() => skip (control-flow)"]
  cond_6{"() => skip"}
  n7["Effect"]

  %% Edges
  n5 --> cond_6
  cond_6 -->|true| n7
  n4 --> n5
  n3 --> n4
  n2 --> n3
  start --> n2
  n7 --> end_node
  cond_6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 pipeStyle
  class n4 effectStyle
  class n5 conditionalStyle
  class cond_6 conditionalStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Conditionals**: 1


## Explanation

```
conditionalUnlessProgram (generator):
  1. Calls log
  2. result = Pipes succeed through:
    Calls succeed — constructor
    If () => skip:
      Calls Effect

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: complexConditionalProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.134Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: complexConditionalProgram

  start((Start))
  end_node((End))

  n2["flags.a (control-flow)"]
  cond_3{"flags.a"}
  n4["gen"]
  n5["succeed"]

  %% Edges
  n2 --> cond_3
  cond_3 -->|true| n4
  cond_3 -->|false| n5
  start --> n2
  n4 --> end_node
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 conditionalStyle
  class cond_3 conditionalStyle
  class n4 effectStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Conditionals**: 1


## Explanation

```
complexConditionalProgram (generator):
  1. resultA = If flags.a:
    Calls gen
  2. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: resultA.onTrue

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.136Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: resultA.onTrue

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["return"]
  term_4(["return"])
  n5["flags.b (control-flow)"]
  cond_6{"flags.b"}
  n7["succeed"]
  n8["succeed"]

  %% Edges
  n5 --> cond_6
  cond_6 -->|true| n7
  cond_6 -->|false| n8
  n3 --> n5
  n7 --> term_4
  n8 --> term_4
  n2 --> n3
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef conditionalStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 terminalStyle
  class term_4 terminalStyle
  class n5 conditionalStyle
  class cond_6 conditionalStyle
  class n7 effectStyle
  class n8 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Conditionals**: 1


## Explanation

```
resultA.onTrue (generator):
  1. Calls log
  2. Returns:
    If flags.b:
      Calls succeed — constructor
    Else:
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: recursiveProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.138Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: recursiveProgram

  start((Start))
  end_node((End))

  n2["prev <- recursiveProgram (side-effect)"]

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
recursiveProgram (generator):
  1. Yields prev <- recursiveProgram

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: repeatProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.145Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: repeatProgram

  start((Start))
  end_node((End))

  n2["Pipe (1 steps)"]
  n3["sync (side-effect)"]
  n4["repeat (side-effect)"]

  %% Edges
  n3 --> n4
  n2 --> n3
  start --> n2
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
repeatProgram (generator):
  1. result = Pipes sync through:
    Calls sync — constructor
    Calls repeat

  Error paths: E
  Concurrency: sequential (no parallelism)
```


## Error Types

- `E`



---

# Effect Analysis: concurrentForEachProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.152Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: concurrentForEachProgram

  start((Start))
  end_node((End))

  n2["forEach(items) (control-flow)"]
  loop_3(["forEach(items)"])
  n4["⚠ callback-body"]
  opaque_5{{"forEach callback: Effect.sleep -> item.toUpperCase -> Effect.gen"}}

  %% Edges
  n2 --> loop_3
  loop_3 -->|iterate| opaque_5
  opaque_5 -->|next| loop_3
  start --> n2
  loop_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  classDef opaqueStyle fill:#FF9800,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 loopStyle
  class loop_3 loopStyle
  class n4 opaqueStyle
  class opaque_5 opaqueStyle
```


## Statistics

- **Loops**: 1


## Explanation

```
concurrentForEachProgram (generator):
  1. results = Iterates (forEach) over items:
    forEach callback: Effect.sleep -> item.toUpperCase -> Effect…
    Callback:
      Calls sleep — callback-call
      Calls item.toUpperCase — callback-call
      Calls gen — callback-call

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: results

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.153Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: results

  start((Start))
  end_node((End))

  n2["sleep (side-effect)"]
  n3["return"]
  term_4(["return"])
  n5["item.toUpperCase (side-effect)"]

  %% Edges
  n3 --> n5
  n5 --> term_4
  n2 --> n3
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 terminalStyle
  class term_4 terminalStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
results (generator):
  1. Calls sleep
  2. Returns:
    Calls item.toUpperCase

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: chainedErrorHandlerProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.162Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: chainedErrorHandlerProgram

  start((Start))
  end_node((End))

  n2["Pipe (3 steps)"]
  n3["fail"]
  n4["catchTag (error-handler)"]
  n5["Effect"]
  err_handler_6["catchTag"]
  n7["Unknown: Could not determine effect type"]
  n8["catchTag (error-handler)"]
  n9["Effect"]
  err_handler_10["catchTag"]
  n11["Unknown: Could not determine effect type"]
  n12["catchTag (error-handler)"]
  n13["Effect"]
  err_handler_14["catchTag"]
  n15["Unknown: Could not determine effect type"]

  %% Edges
  n5 -->|on ErrorA| err_handler_6
  err_handler_6 --> n7
  n3 --> n5
  n9 -->|on ErrorB| err_handler_10
  err_handler_10 --> n11
  n7 --> n9
  n13 -->|on ErrorC| err_handler_14
  err_handler_14 --> n15
  n11 --> n13
  n2 --> n3
  start --> n2
  n15 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 errorHandlerStyle
  class n5 effectStyle
  class err_handler_6 errorHandlerStyle
  class n7 unknownStyle
  class n8 errorHandlerStyle
  class n9 effectStyle
  class err_handler_10 errorHandlerStyle
  class n11 unknownStyle
  class n12 errorHandlerStyle
  class n13 effectStyle
  class err_handler_14 errorHandlerStyle
  class n15 unknownStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 3
- **Unknown Nodes**: 3


## Explanation

```
chainedErrorHandlerProgram (generator):
  1. result = Pipes fail through:
    Calls fail — constructor
    Catches tag "ErrorA" on:
      Calls Effect
      Handler:
        (unknown: Could not determine effect type)
    Catches tag "ErrorB" on:
      Calls Effect
      Handler:
        (unknown: Could not determine effect type)
    Catches tag "ErrorC" on:
      Calls Effect
      Handler:
        (unknown: Could not determine effect type)

  Error paths: { _tag: "ErrorA"; }
  Concurrency: sequential (no parallelism)
```


## Error Types

- `{ _tag: "ErrorA"; }`



---

# Effect Analysis: catchCauseProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.166Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: catchCauseProgram

  start((Start))
  end_node((End))

  n2["Pipe (1 steps)"]
  n3["fail"]
  n4["catchCause (error-handler)"]
  n5["Effect"]
  err_handler_6["catchCause"]
  n7["gen"]

  %% Edges
  n5 -->|on error| err_handler_6
  err_handler_6 --> n7
  n3 --> n5
  n2 --> n3
  start --> n2
  n7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 errorHandlerStyle
  class n5 effectStyle
  class err_handler_6 errorHandlerStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Error Handlers**: 1


## Explanation

```
catchCauseProgram (generator):
  1. result = Pipes fail through:
    Calls fail — constructor
    Handles errors (catchCause):
      Calls Effect
      Handler:
        Calls gen

  Error paths: string
  Concurrency: sequential (no parallelism)
```


## Error Types

- `string`



---

# Effect Analysis: result

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.167Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: result

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
result (generator):
  1. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: tapErrorProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.171Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: tapErrorProgram

  start((Start))
  end_node((End))

  n2["Pipe (2 steps)"]
  n3["fail"]
  n4["tapError (transform)"]
  n5["orElse (error-handler)"]
  n6["Effect"]
  err_handler_7["orElse"]
  n8["succeed"]

  %% Edges
  n3 --> n4
  n6 -->|on error| err_handler_7
  err_handler_7 --> n8
  n4 --> n6
  n2 --> n3
  start --> n2
  n8 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 transformStyle
  class n5 errorHandlerStyle
  class n6 effectStyle
  class err_handler_7 errorHandlerStyle
  class n8 effectStyle
```


## Statistics

- **Total Effects**: 4
- **Error Handlers**: 1


## Explanation

```
tapErrorProgram (generator):
  1. result = Pipes fail through:
    Calls fail — constructor
    Transforms via tapError
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

# Effect Analysis: orElseChainProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.174Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: orElseChainProgram

  start((Start))
  end_node((End))

  n2["Pipe (2 steps)"]
  n3["fail"]
  n4["orElse (error-handler)"]
  n5["Effect"]
  err_handler_6["orElse"]
  n7["fail"]
  n8["orElse (error-handler)"]
  n9["Effect"]
  err_handler_10["orElse"]
  n11["succeed"]

  %% Edges
  n5 -->|on error| err_handler_6
  err_handler_6 --> n7
  n3 --> n5
  n9 -->|on error| err_handler_10
  err_handler_10 --> n11
  n7 --> n9
  n2 --> n3
  start --> n2
  n11 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 errorHandlerStyle
  class n5 effectStyle
  class err_handler_6 errorHandlerStyle
  class n7 effectStyle
  class n8 errorHandlerStyle
  class n9 effectStyle
  class err_handler_10 errorHandlerStyle
  class n11 effectStyle
```


## Statistics

- **Total Effects**: 5
- **Error Handlers**: 2


## Explanation

```
orElseChainProgram (generator):
  1. result = Pipes fail through:
    Calls fail — constructor
    Falls back (orElse) on error:
      Calls Effect
      Handler:
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

# Effect Analysis: mixedParallelSequentialProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.186Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: mixedParallelSequentialProgram

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["Effect.all (2) (concurrency)"]
  parallel_fork_4{{"All (2)"}}
  parallel_join_4{{"Join"}}
  n5["succeed"]
  n6["succeed"]
  n7["log (side-effect)"]
  n8["Effect.all (3) (concurrency)"]
  parallel_fork_9{{"All (3)"}}
  parallel_join_9{{"Join"}}
  n10["succeed"]
  n11["succeed"]
  n12["succeed"]
  n13["log (side-effect)"]

  %% Edges
  n3 --> parallel_fork_4
  parallel_fork_4 -->|succeed| n5
  n5 --> parallel_join_4
  parallel_fork_4 -->|succeed| n6
  n6 --> parallel_join_4
  n2 --> n3
  parallel_join_4 --> n7
  n8 --> parallel_fork_9
  parallel_fork_9 -->|succeed| n10
  n10 --> parallel_join_9
  parallel_fork_9 -->|succeed| n11
  n11 --> parallel_join_9
  parallel_fork_9 -->|succeed| n12
  n12 --> parallel_join_9
  n7 --> n8
  parallel_join_9 --> n13
  start --> n2
  n13 --> end_node

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
  class n8 parallelStyle
  class parallel_fork_9 parallelStyle
  class parallel_join_9 parallelStyle
  class n10 effectStyle
  class n11 effectStyle
  class n12 effectStyle
  class n13 effectStyle
```


## Statistics

- **Total Effects**: 8
- **Parallel Operations**: 2


## Explanation

```
mixedParallelSequentialProgram (generator):
  1. Calls log
  2. [result1, result2] = Runs 2 effects in sequential:
    Calls succeed — constructor
    Calls succeed — constructor
  3. Calls log
  4. [result3, result4, result5] = Runs 3 effects in sequential:
    Calls succeed — constructor
    Calls succeed — constructor
    Calls succeed — constructor
  5. Calls log

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: raceWithFallbackProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.194Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: raceWithFallbackProgram

  start((Start))
  end_node((End))

  n2["Pipe (1 steps)"]
  n3["Effect.race (2 racing) (concurrency)"]
  race_fork_4{{{"Race (2)"}}}
  race_join_4{{{"Winner"}}}
  n5["fast"]
  n6["slow"]
  n7["orElse (error-handler)"]
  n8["Effect"]
  err_handler_9["orElse"]
  n10["succeed"]
  n11["Pipe (1 steps)"]
  n12["sleep (side-effect)"]
  n13["as (transform)"]
  n14["sleep (side-effect)"]
  n15["as (transform)"]
  n16["Pipe (1 steps)"]
  n17["sleep (side-effect)"]
  n18["as (transform)"]
  n19["sleep (side-effect)"]
  n20["as (transform)"]

  %% Edges
  n3 --> race_fork_4
  race_fork_4 -->|fast| n5
  n5 --> race_join_4
  race_fork_4 -->|slow| n6
  n6 --> race_join_4
  n8 -->|on error| err_handler_9
  err_handler_9 --> n10
  race_join_4 --> n8
  n2 --> n3
  n12 --> n13
  n11 --> n12
  n10 --> n11
  n13 --> n14
  n14 --> n15
  n17 --> n18
  n16 --> n17
  n15 --> n16
  n18 --> n19
  n19 --> n20
  start --> n2
  n20 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef raceStyle fill:#FF6347,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef transformStyle fill:#A5D6A7,stroke:#388E3C,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 raceStyle
  class race_fork_4 raceStyle
  class race_join_4 raceStyle
  class n5 effectStyle
  class n6 effectStyle
  class n7 errorHandlerStyle
  class n8 effectStyle
  class err_handler_9 errorHandlerStyle
  class n10 effectStyle
  class n11 pipeStyle
  class n12 effectStyle
  class n13 transformStyle
  class n14 effectStyle
  class n15 transformStyle
  class n16 pipeStyle
  class n17 effectStyle
  class n18 transformStyle
  class n19 effectStyle
  class n20 transformStyle
```


## Statistics

- **Total Effects**: 12
- **Race Operations**: 1
- **Error Handlers**: 1


## Explanation

```
raceWithFallbackProgram (generator):
  1. winner = Pipes Effect.race(2 effects) through:
    Races 2 effects:
      Calls fast
      Calls slow
    Falls back (orElse) on error:
      Calls Effect
      Handler:
        Calls succeed — constructor
  2. Pipes sleep through:
    Calls sleep
    Transforms via as
  3. Calls sleep
  4. Transforms via as
  5. Pipes sleep through:
    Calls sleep
    Transforms via as
  6. Calls sleep
  7. Transforms via as

  Concurrency: uses parallelism / racing
```



---

# Effect Analysis: optionToEffectProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.196Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: optionToEffectProgram

  start((Start))
  end_node((End))

  n2["match (error-handler)"]
  n3["Option"]
  err_handler_4["match"]
  n5["maybeValue"]

  %% Edges
  n3 -->|on error| err_handler_4
  err_handler_4 --> n5
  start --> n3
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 errorHandlerStyle
  class n3 effectStyle
  class err_handler_4 errorHandlerStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Error Handlers**: 1


## Explanation

```
optionToEffectProgram (generator):
  1. value = Handles errors (match):
    Calls Option
    Handler:
      Calls maybeValue

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: eitherToEffectProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.200Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: eitherToEffectProgram

  start((Start))
  end_node((End))

  n2["match (error-handler)"]
  n3["Either"]
  err_handler_4["match"]
  n5["either"]

  %% Edges
  n3 -->|on error| err_handler_4
  err_handler_4 --> n5
  start --> n3
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 errorHandlerStyle
  class n3 effectStyle
  class err_handler_4 errorHandlerStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2
- **Error Handlers**: 1


## Explanation

```
eitherToEffectProgram (generator):
  1. value = Handles errors (match):
    Calls Either
    Handler:
      Calls either

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: optionWithinEffectProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.202Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: optionWithinEffectProgram

  start((Start))
  end_node((End))

  n2["match (error-handler)"]
  n3["Option"]
  err_handler_4["match"]
  n5["maybeNumber"]
  n6["some (side-effect)"]

  %% Edges
  n3 -->|on error| err_handler_4
  err_handler_4 --> n5
  n5 --> n6
  start --> n3
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 errorHandlerStyle
  class n3 effectStyle
  class err_handler_4 errorHandlerStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3
- **Error Handlers**: 1


## Explanation

```
optionWithinEffectProgram (generator):
  1. result = Handles errors (match):
    Calls Option
    Handler:
      Calls maybeNumber
  2. Calls some — option

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: arrayOperationsProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.205Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: arrayOperationsProgram

  start((Start))
  end_node((End))

  n1["Generator (0 yields)"]

  %% Edges
  start --> n1
  n1 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef generatorStyle fill:#FFB6C1,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 generatorStyle
```


## Statistics

- No operations found


## Explanation

```
arrayOperationsProgram (generator):


  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: conditionalIfProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.206Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: conditionalIfProgram

  start((Start))
  end_node((End))

  n1["condition (control-flow)"]
  cond_2{"condition"}
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
conditionalIfProgram (direct):
  1. If condition:
    Calls succeed — constructor
  2. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: loopProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/complex-composition.ts`
- **Analyzed**: 2026-05-22T16:10:30.209Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: loopProgram

  start((Start))
  end_node((End))

  n1["loop(0) (control-flow)"]
  loop_2(["loop(0)"])
  n3["Unknown: Could not determine effect type"]

  %% Edges
  n1 --> loop_2
  loop_2 -->|iterate| n3
  n3 -->|next| loop_2
  start --> n1
  loop_2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 loopStyle
  class loop_2 loopStyle
  class n3 unknownStyle
```


## Statistics

- **Loops**: 1
- **Unknown Nodes**: 1


## Explanation

```
loopProgram (direct):
  1. Iterates (loop) over 0:
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```

