# Effect Analysis: validate-transfer.ts

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/validate-transfer.ts`
- **Analyzed**: 2026-04-01T19:13:24.242Z
- **Source Type**: direct

## Effect Flow

```mermaid
flowchart TB

  %% Program: validateTransfer

  start((Start))
  end_node((End))

  n1["decodeUnknown <ValidatedTransfer, ValidationError, never> (side-effect)"]

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
validateTransfer (direct):
  1. Calls decodeUnknown — schema

  Error paths: ValidationError
  Concurrency: sequential (no parallelism)
```

## Error Types

- `ValidationError`
