# Effect Analysis: subRefProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/subscription-ref.ts`
- **Analyzed**: 2026-05-22T16:10:34.626Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: subRefProgram

  start((Start))
  end_node((End))

  n2["subscriptionRef.create (concurrency)"]
  n3["subscriptionRef.set (concurrency)"]
  n4["subscriptionRef.get (concurrency)"]
  n5["subscriptionRef.update (concurrency)"]
  n6["Stream (stream)"]
  n7["subscriptionRef.changes (concurrency)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n6 --> n7
  n5 --> n6
  start --> n2
  n7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef streamStyle fill:#E0F7FA,stroke:#333,stroke-width:2px
  classDef concurrencyPrimitiveStyle fill:#B0E0E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 concurrencyPrimitiveStyle
  class n3 concurrencyPrimitiveStyle
  class n4 concurrencyPrimitiveStyle
  class n5 concurrencyPrimitiveStyle
  class n6 streamStyle
  class n7 concurrencyPrimitiveStyle
```


## Statistics

- No operations found


## Explanation

```
subRefProgram (generator):
  1. ref = subscriptionRef.create
  2. subscriptionRef.set
  3. value = subscriptionRef.get
  4. subscriptionRef.update
  5. Stream: 
    subscriptionRef.changes

  Concurrency: sequential (no parallelism)
```

