# Effect Analysis: migration

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/tagged-template-sql.ts`
- **Analyzed**: 2026-05-22T16:10:34.700Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: migration

  start((Start))
  end_node((End))

  n2["sql <- SqlClient.SqlClient (service-call) R: SqlClient"]
  n3["sql (side-effect)"]
  n4["sql (side-effect)"]
  n5["rows <- sql (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  start --> n2
  n5 --> end_node

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
```


## Statistics

- **Total Effects**: 4


## Explanation

```
migration (generator):
  1. sql = SqlClient.SqlClient — service-call
  2. Calls sql — side-effect
  3. Calls sql — side-effect
  4. Yields rows <- sql

  Services required: SqlClient
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `SqlClient`: SqlClient

