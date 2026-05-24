# Effect Analysis: userLookupProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.786Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: userLookupProgram

  start((Start))
  end_node((End))

  n2["repo <- UserRepoService (environment)"]
  n3["user <- repo.getById (service-call)"]

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
userLookupProgram (generator):
  1. Yields repo <- UserRepoService
  2. user = UserRepo.getById — service-call

  Services required: UserRepoService, UserRepo
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `UserRepoService`



---

# Effect Analysis: liveRepoLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.788Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: liveRepoLayer

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["UserRepoService"]
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
liveRepoLayer (direct):
  1. Provides layer providing UserRepoService (requires UserRepoService):
    Calls UserRepoService
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: mockRepoLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.789Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: mockRepoLayer

  start((Start))
  end_node((End))

  n1["Layer (layer)"]
  n2["UserRepoService"]
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
mockRepoLayer (direct):
  1. Provides layer providing UserRepoService (requires UserRepoService):
    Calls UserRepoService
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: withLiveLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.790Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: withLiveLayer

  start((Start))
  end_node((End))

  n1["provide (side-effect)"]

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
withLiveLayer (direct):
  1. Calls provide — context

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: withMockLayer

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.790Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: withMockLayer

  start((Start))
  end_node((End))

  n1["provide (side-effect)"]

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
withMockLayer (direct):
  1. Calls provide — context

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserRepoService

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/testing-mocks.ts`
- **Analyzed**: 2026-05-22T16:10:34.790Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserRepoService

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
UserRepoService (class):
  1. Calls Context.Tag — service-tag

  Concurrency: sequential (no parallelism)
```

