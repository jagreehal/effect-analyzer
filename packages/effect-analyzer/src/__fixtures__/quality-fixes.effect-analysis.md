# Effect Analysis: validateUser

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.482Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: validateUser

  start((Start))
  end_node((End))

  n2["user <- decodeUnknown (side-effect)"]

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
validateUser (generator):
  1. Yields user <- decodeUnknown

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: validateUserDecode

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.484Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: validateUserDecode

  start((Start))
  end_node((End))

  n2["user <- decode (side-effect)"]

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
validateUserDecode (generator):
  1. Yields user <- decode

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: namedStepsProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.487Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: namedStepsProgram

  start((Start))
  end_node((End))

  n2["config <- succeed"]
  n3["response <- tryPromise (side-effect)"]
  n4["data <- tryPromise (side-effect)"]

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
namedStepsProgram (generator):
  1. Yields config <- succeed
  2. Yields response <- tryPromise
  3. Yields data <- tryPromise

  Error paths: UnknownException
  Concurrency: sequential (no parallelism)
```


## Error Types

- `UnknownException`



---

# Effect Analysis: spanAnnotatedProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.488Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: spanAnnotatedProgram

  start((Start))
  end_node((End))

  n2["Pipe (0 steps)"]
  n3["succeed"]

  %% Edges
  n2 --> n3
  start --> n2
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
spanAnnotatedProgram (generator):
  1. result = Pipes succeed through:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: verboseLabelsProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.489Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: verboseLabelsProgram

  start((Start))
  end_node((End))

  n2["result <- succeed"]

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
verboseLabelsProgram (generator):
  1. Yields result <- succeed

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: chainedWithSpanProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.491Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: chainedWithSpanProgram

  start((Start))
  end_node((End))

  n2["Pipe (0 steps)"]
  n3["succeed"]

  %% Edges
  n2 --> n3
  start --> n2
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
chainedWithSpanProgram (generator):
  1. x = Pipes succeed through:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: multiSpanProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.496Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: multiSpanProgram

  start((Start))
  end_node((End))

  n2["Pipe (0 steps)"]
  n3["succeed"]
  n4["Pipe (0 steps)"]
  n5["succeed"]

  %% Edges
  n2 --> n3
  n4 --> n5
  n3 --> n4
  start --> n2
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 pipeStyle
  class n3 effectStyle
  class n4 pipeStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
multiSpanProgram (generator):
  1. a = Pipes succeed through:
    Calls succeed — constructor
  2. b = Pipes succeed through:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/quality-fixes.ts`
- **Analyzed**: 2026-05-22T16:10:33.497Z
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

