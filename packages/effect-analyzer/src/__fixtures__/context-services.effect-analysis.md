# Effect Analysis: serviceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.296Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: serviceProgram

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["config <- Config (environment)"]
  n4["logger.info (side-effect)"]
  n5["dbUrl <- config.getOrDefault (side-effect)"]
  n6["logger.debug (side-effect)"]

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
serviceProgram (generator):
  1. Yields logger <- Logger
  2. Yields config <- Config
  3. Calls logger.info
  4. Yields dbUrl <- config.getOrDefault
  5. Calls logger.debug

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: databaseProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.301Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: databaseProgram

  start((Start))
  end_node((End))

  n2["db <- Database (environment)"]
  n3["logger <- Logger (environment)"]
  n4["logger.info (side-effect)"]
  n5["results <- db.query (service-call)"]
  n6["logger.info (side-effect)"]

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
databaseProgram (generator):
  1. Yields db <- Database
  2. Yields logger <- Logger
  3. Calls logger.info
  4. Yields results <- db.query
  5. Calls logger.info

  Services required: Database
  Error paths: DatabaseError
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `Database`


## Error Types

- `DatabaseError`



---

# Effect Analysis: nestedServiceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.305Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: nestedServiceProgram

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["db <- Database (environment)"]
  n4["logger.info (side-effect)"]
  n5["result <- db.transaction (service-call)"]
  n6["logger.info (side-effect)"]
  n7["catchTag (error-handler)"]
  n8["Effect"]
  err_handler_9["catchTag"]
  n10["Unknown: Could not determine effect type"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n8 -->|on error| err_handler_9
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
nestedServiceProgram (generator):
  1. Yields logger <- Logger
  2. Yields db <- Database
  3. Calls logger.info
  4. Yields result <- db.transaction
  5. Calls logger.info

  Services required: Database
  Error paths: DatabaseError
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `Database`


## Error Types

- `DatabaseError`



---

# Effect Analysis: result

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.306Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: result

  start((Start))
  end_node((End))

  n2["logger.info (side-effect)"]
  n3["users <- db.query (side-effect)"]

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
result (generator):
  1. Calls logger.info
  2. Yields users <- db.query

  Error paths: DatabaseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `DatabaseError`



---

# Effect Analysis: nestedServiceProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.311Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: nestedServiceProgram

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["logger.error (side-effect)"]

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
nestedServiceProgram (generator):
  1. Yields logger <- Logger
  2. Calls logger.error

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ConfigLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.317Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ConfigLive

  start((Start))
  end_node((End))

  n2["return"]
  term_3(["return"])
  n4["gen"]
  n5["configMap.get (side-effect)"]
  n6["fail"]
  n7["succeed"]

  %% Edges
  n4 --> n5
  n5 --> n6
  n6 --> n7
  n2 --> n4
  n7 --> term_3
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
  class n5 effectStyle
  class n6 effectStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 5


## Explanation

```
ConfigLive (generator):
  1. Returns:
    Calls gen
    Calls configMap.get
    Calls fail — constructor
    Calls succeed — constructor

  Error paths: ConfigError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ConfigError`



---

# Effect Analysis: ConfigLive.get

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.318Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ConfigLive.get

  start((Start))
  end_node((End))

  decision_3{"value === undefined"}
  n4["return"]
  term_5(["return"])
  n6["fail"]

  %% Edges
  n4 --> n6
  n6 --> term_5
  decision_3 -->|yes| n4
  start --> decision_3
  decision_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class decision_3 decisionStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
ConfigLive.get (generator):
  1. If value === undefined:
    Returns:
      Calls fail — constructor

  Error paths: ConfigError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ConfigError`



---

# Effect Analysis: DatabaseLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.324Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: DatabaseLive

  start((Start))
  end_node((End))

  n2["config <- Config (environment)"]
  n3["dbUrl <- config.getOrDefault (side-effect)"]
  n4["return"]
  term_5(["return"])
  n6["gen"]
  n7["log (side-effect)"]

  %% Edges
  n2 --> n3
  n6 --> n7
  n4 --> n6
  n7 --> term_5
  n3 --> n4
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
  class n3 effectStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 effectStyle
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 7


## Explanation

```
DatabaseLive (generator):
  1. Yields config <- Config
  2. Yields dbUrl <- config.getOrDefault
  3. Returns:
    Calls gen
    Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: DatabaseLive.query

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.325Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: DatabaseLive.query

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
DatabaseLive.query (generator):
  1. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: DatabaseLive.transaction

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.326Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: DatabaseLive.transaction

  start((Start))
  end_node((End))

  n2["log (side-effect)"]
  n3["result <- effect (side-effect)"]
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
DatabaseLive.transaction (generator):
  1. Calls log
  2. Yields result <- effect
  3. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: programWithFreshLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.332Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: programWithFreshLayer

  start((Start))
  end_node((End))

  n2["logger <- Logger (environment)"]
  n3["logger.info (side-effect)"]
  n4["provide (layer)"]

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
programWithFreshLayer (generator):
  1. Yields logger <- Logger
  2. Calls logger.info

  Error paths: E
  Concurrency: sequential (no parallelism)
```


## Error Types

- `E`



---

# Effect Analysis: LoggerLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.333Z
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

# Effect Analysis: AppLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.337Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AppLayer

  start((Start))
  end_node((End))

  n1["Layer (merged) (layer)"]
  n2["Layer (layer)"]
  n3["Logger"]
  n4["Unknown: Could not determine effect type"]
  n5["Layer (layer)"]
  n6["Config"]
  n7["gen"]
  n8["Layer (layer)"]
  n9["Layer (layer)"]
  n10["Layer (layer)"]
  n11["Config"]
  n12["gen"]

  %% Edges
  n3 --> n4
  n2 --> n3
  n6 --> n7
  n5 --> n6
  n4 --> n5
  n11 --> n12
  n10 --> n11
  n9 --> n10
  n8 --> n9
  n7 --> n8
  n1 --> n2
  start --> n1
  n12 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef layerStyle fill:#E6E6FA,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 layerStyle
  class n2 layerStyle
  class n3 effectStyle
  class n4 unknownStyle
  class n5 layerStyle
  class n6 effectStyle
  class n7 effectStyle
  class n8 layerStyle
  class n9 layerStyle
  class n10 layerStyle
  class n11 effectStyle
  class n12 effectStyle
```


## Statistics

- **Total Effects**: 5
- **Unknown Nodes**: 1


## Explanation

```
AppLayer (direct):
  1. Provides layer (requires ConfigLive):
    Provides layer providing Logger:
      Calls Logger
      (unknown: Could not determine effect type)
    Provides layer providing Config:
      Calls Config
      Calls gen
    Provides layer providing ConfigLive (requires ConfigLive):
      Provides layer (requires ConfigLive):
        Provides layer providing Config:
          Calls Config
          Calls gen

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: programWithLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.338Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: programWithLayer

  start((Start))
  end_node((End))

  n1["databaseProgram.pipe (service-call)"]

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
programWithLayer (direct):
  1. Calls Effect.pipe — service-call

  Error paths: DatabaseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `DatabaseError`



---

# Effect Analysis: programWithMergedLayers

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.340Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: programWithMergedLayers

  start((Start))
  end_node((End))

  n1["nestedServiceProgram.pipe (service-call)"]

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
programWithMergedLayers (direct):
  1. Calls Effect.pipe — service-call

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: Database

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.340Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: Database

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
Database (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: Config

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.341Z
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



---

# Effect Analysis: Logger

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/context-services.ts`
- **Analyzed**: 2026-05-22T16:10:30.341Z
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

