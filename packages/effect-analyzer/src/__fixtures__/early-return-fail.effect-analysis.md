# Effect Analysis: earlyReturnFail

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/early-return-fail.ts`
- **Analyzed**: 2026-05-22T16:10:31.822Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: earlyReturnFail

  start((Start))
  end_node((End))

  n2["balance <- succeed"]
  n3["amount <- succeed"]
  decision_5{"balance < amount"}
  n6["return"]
  term_7(["return"])
  n8["fail"]
  n9["result <- succeed"]

  %% Edges
  n2 --> n3
  n6 --> n8
  n8 --> term_7
  decision_5 -->|yes| n6
  n3 --> decision_5
  decision_5 --> n9
  start --> n2
  n9 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class decision_5 decisionStyle
  class n6 terminalStyle
  class term_7 terminalStyle
  class n8 effectStyle
  class n9 effectStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
earlyReturnFail (generator):
  1. Yields balance <- succeed
  2. Yields amount <- succeed
  3. If balance < amount:
    Returns:
      Calls fail — constructor
  4. Yields result <- succeed

  Error paths: InsufficientFundsError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `InsufficientFundsError`

