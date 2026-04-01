# Effect Analysis: fetch-rate.ts

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/fetch-rate.ts`
- **Analyzed**: 2026-04-01T19:18:08.954Z
- **Source Type**: generator

## Effect Flow

```mermaid
flowchart TB

  %% Program: fetchRate

  start((Start))
  end_node((End))

  n2["rates <- deps.getRates <RateMatrix, RateUnavailableError, never> (side-effect)"]
  decision_4{"rate === undefined"}
  n5["return"]
  term_6(["return"])
  n7["fail <never, RateUnavailableError, never>"]

  %% Edges
  n5 --> n7
  n7 --> term_6
  decision_4 -->|yes| n5
  n2 --> decision_4
  start --> n2
  decision_4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class decision_4 decisionStyle
  class n5 terminalStyle
  class term_6 terminalStyle
  class n7 effectStyle
```

## Statistics

- **Total Effects**: 2

## Explanation

```
fetchRate (generator):
  1. Yields rates <- deps.getRates
  2. If rate === undefined:
    Returns:
      Calls fail — constructor

  Error paths: RateUnavailableError
  Concurrency: sequential (no parallelism)
```

## Error Types

- `RateUnavailableError`
