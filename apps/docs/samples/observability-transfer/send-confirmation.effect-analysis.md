# Effect Analysis: send-confirmation.ts

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/send-confirmation.ts`
- **Analyzed**: 2026-04-01T19:13:23.055Z
- **Source Type**: direct

## Effect Flow

```mermaid
flowchart TB

  %% Program: sendConfirmation

  start((Start))
  end_node((End))

  n1["deps.notify <void, ConfirmationFailedError, never> (side-effect)"]

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
sendConfirmation (direct):
  1. Calls deps.notify

  Error paths: ConfirmationFailedError
  Concurrency: sequential (no parallelism)
```

## Error Types

- `ConfirmationFailedError`
