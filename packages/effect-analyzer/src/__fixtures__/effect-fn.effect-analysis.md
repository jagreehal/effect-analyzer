# Effect Analysis: program

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/effect-fn.ts`
- **Analyzed**: 2026-05-22T16:10:31.977Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: program

  start((Start))
  end_node((End))

  n2["result <- fn"]
  n3["result2 <- fnUntraced"]
  n4["nullable <- fromNullable"]
  n5["succeed"]
  n6["sync (side-effect)"]
  n7["promise (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n6 --> n7
  start --> n2
  n7 --> end_node

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
  class n7 effectStyle
```


## Statistics

- **Total Effects**: 6


## Explanation

```
program (generator):
  1. Yields nullable <- fromNullable
  2. Calls succeed — constructor
  3. Calls sync — constructor
  4. Calls promise — constructor

  Error paths: NoSuchElementException, any
  Concurrency: sequential (no parallelism)
```


## Error Types

- `NoSuchElementException`
- `any`

