# Effect Analysis: MyPoint

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/equal-hash-class.ts`
- **Analyzed**: 2026-05-22T16:10:32.277Z
- **Source Type**: class
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: MyPoint

  start((Start))
  end_node((End))

  n1["Data.Class"]

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
MyPoint (class):
  1. Calls Data.Class — data

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: MyPoint.[Hash.symbol]

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/equal-hash-class.ts`
- **Analyzed**: 2026-05-22T16:10:32.279Z
- **Source Type**: classMethod
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: MyPoint.[Hash.symbol]

  start((Start))
  end_node((End))

  n1["combine (side-effect)"]

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
MyPoint.[Hash.symbol] (classMethod):
  1. Calls combine

  Concurrency: sequential (no parallelism)
```

