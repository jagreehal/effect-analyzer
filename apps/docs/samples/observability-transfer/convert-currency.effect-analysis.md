# Effect Analysis: convert-currency.ts

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/convert-currency.ts`
- **Analyzed**: 2026-04-01T19:18:07.995Z
- **Source Type**: generator

## Effect Flow

```mermaid
flowchart TB

  %% Program: convertCurrency

  start((Start))
  end_node((End))

  decision_3{"args.balance < args.amount"}
  n4["return"]
  term_5(["return"])
  n6["fail <never, InsufficientFundsError, never>"]

  %% Edges
  n4 --> n6
  n6 --> term_5
  decision_3 -->|yes| n4
  start --> decision_3
  decision_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class decision_3 decisionStyle
  class n4 terminalStyle
  class term_5 terminalStyle
  class n6 effectStyle
```

## Statistics

- **Total Effects**: 1

## Explanation

```
convertCurrency (generator):
  1. If args.balance < args.amount:
    Returns:
      Calls fail — constructor

  Error paths: InsufficientFundsError
  Concurrency: sequential (no parallelism)
```

## Error Types

- `InsufficientFundsError`
