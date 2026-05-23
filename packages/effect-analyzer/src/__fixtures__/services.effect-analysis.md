# Effect Analysis: UserRepoLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.350Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserRepoLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["UserRepo"]
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
UserRepoLive (direct):
  1. Provides layer providing UserRepo:
    Calls UserRepo
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: AppConfigLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.352Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AppConfigLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["AppConfig"]
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
AppConfigLive (direct):
  1. Provides layer providing AppConfig:
    Calls AppConfig
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: CustomServiceLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.353Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: CustomServiceLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["CustomService"]
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
CustomServiceLive (direct):
  1. Provides layer providing CustomService (requires CustomService):
    Calls CustomService
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: DbLive

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.359Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: DbLive

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["Db"]
  n3["succeed"]

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
  class start startStyle
  class end_node endStyle
  class n1 layerStyle
  class n2 effectStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
DbLive (direct):
  1. Provides layer providing Db:
    Calls Db
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: AppLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.361Z
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
  n3["UserRepo"]
  n4["Unknown: Could not determine effect type"]
  n5["Layer (layer)"]
  n6["AppConfig"]
  n7["Unknown: Could not determine effect type"]
  n8["Layer (layer)"]
  n9["CustomService"]
  n10["Unknown: Could not determine effect type"]
  n11["Layer (layer)"]
  n12["Db"]
  n13["succeed"]

  %% Edges
  n3 --> n4
  n2 --> n3
  n6 --> n7
  n5 --> n6
  n4 --> n5
  n9 --> n10
  n8 --> n9
  n7 --> n8
  n12 --> n13
  n11 --> n12
  n10 --> n11
  n1 --> n2
  start --> n1
  n13 --> end_node

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
  class n7 unknownStyle
  class n8 layerStyle
  class n9 effectStyle
  class n10 unknownStyle
  class n11 layerStyle
  class n12 effectStyle
  class n13 effectStyle
```


## Statistics

- **Total Effects**: 5
- **Unknown Nodes**: 3


## Explanation

```
AppLayer (direct):
  1. Provides layer (requires CustomService):
    Provides layer providing UserRepo:
      Calls UserRepo
      (unknown: Could not determine effect type)
    Provides layer providing AppConfig:
      Calls AppConfig
      (unknown: Could not determine effect type)
    Provides layer providing CustomService (requires CustomService):
      Calls CustomService
      (unknown: Could not determine effect type)
    Provides layer providing Db:
      Calls Db
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserRepo

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.361Z
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

# Effect Analysis: AppConfig

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.361Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AppConfig

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
AppConfig (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: CustomService

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.361Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: CustomService

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
CustomService (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: Db

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/services.ts`
- **Analyzed**: 2026-05-22T16:10:34.362Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: Db

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
Db (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```

