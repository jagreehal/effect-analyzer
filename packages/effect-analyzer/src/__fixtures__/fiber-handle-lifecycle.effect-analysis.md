# Effect Analysis: handleProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/fiber-handle-lifecycle.ts`
- **Analyzed**: 2026-05-22T16:10:32.437Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: handleProgram

  start((Start))
  end_node((End))

  n2["fiberHandle.create (concurrency)"]
  n3["fiberHandle.run (concurrency)"]
  n4["fiberHandle.run (concurrency)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  start --> n2
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef concurrencyPrimitiveStyle fill:#B0E0E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 concurrencyPrimitiveStyle
  class n3 concurrencyPrimitiveStyle
  class n4 concurrencyPrimitiveStyle
```


## Statistics

- No operations found


## Explanation

```
handleProgram (generator):
  1. handle = fiberHandle.create
  2. fiberHandle.run
  3. fiberHandle.run

  Concurrency: sequential (no parallelism)
```

