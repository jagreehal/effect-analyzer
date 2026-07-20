# Effect Analysis: cliMain

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/cli-script.ts`
- **Analyzed**: 2026-05-22T16:10:30.041Z
- **Source Type**: pipe
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: cliMain

  start((Start))
  end_node((End))

  n1["Pipe (1 steps)"]
  n2["gen"]
  n3["catch (error-handler)"]
  n4["Effect"]
  err_handler_5["catch"]
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
cliMain (pipe):
  1. Pipes gen through:
    Calls gen
    Catches all errors on:
      Calls Effect
      Handler:
        Calls succeed — constructor

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`



---

# Effect Analysis: cliMain

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/cli-script.ts`
- **Analyzed**: 2026-05-22T16:10:30.043Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: cliMain

  start((Start))
  end_node((End))

  n2["email <- try"]
  n3["user <- createUser (side-effect)"]
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
cliMain (generator):
  1. Yields email <- try
  2. Yields user <- createUser
  3. Calls log

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`



---

# Effect Analysis: email.try

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/cli-script.ts`
- **Analyzed**: 2026-05-22T16:10:30.043Z
- **Source Type**: run
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: email.try

  start((Start))
  end_node((End))

  n1["parseEmailArg"]

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
email.try (run):
  1. Calls parseEmailArg

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: parseEmailArg

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/cli-script.ts`
- **Analyzed**: 2026-05-22T16:10:30.044Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: parseEmailArg

  start((Start))
  end_node((End))

  n1["sync (side-effect)"]

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
parseEmailArg (direct):
  1. Calls sync — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: createUser

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/cli-script.ts`
- **Analyzed**: 2026-05-22T16:10:30.045Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: createUser

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
createUser (direct):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```

