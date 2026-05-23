# Effect Analysis: processOrder

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-fn-toplevel.ts`
- **Analyzed**: 2026-05-22T16:10:31.900Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: processOrder

  start((Start))
  end_node((End))

  n1["fn"]
  n3["validated <- succeed"]
  n4["log (side-effect)"]
  n5["result <- tryPromise (side-effect)"]

  %% Edges
  n3 --> n4
  n4 --> n5
  n1 --> n3
  start --> n1
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 effectStyle
  class n3 effectStyle
  class n4 effectStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
processOrder (direct):
  1. Yields validated <- succeed
  2. Calls log
  3. Yields result <- tryPromise

  Error paths: UnknownException
  Concurrency: sequential (no parallelism)
```


## Error Types

- `UnknownException`



---

# Effect Analysis: fetchUser

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-fn-toplevel.ts`
- **Analyzed**: 2026-05-22T16:10:31.902Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: fetchUser

  start((Start))
  end_node((End))

  n1["fn"]
  n3["succeed"]
  n4["fail"]

  %% Edges
  n3 --> n4
  n1 --> n3
  start --> n1
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 effectStyle
  class n3 effectStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
fetchUser (direct):
  1. Calls succeed — constructor
  2. Calls fail — constructor

  Error paths: string
  Concurrency: sequential (no parallelism)
```


## Error Types

- `string`

