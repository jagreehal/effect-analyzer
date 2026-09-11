# Effect Analysis: send-money-workflow.ts

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/send-money-workflow.ts`
- **Analyzed**: 2026-09-11T05:50:34.796Z
- **Source Type**: generator

## Effect Flow

```mermaid
flowchart TB

  %% Program: createSendMoneyWorkflow

  start((Start))
  end_node((End))

  n2["validated <- deps.validateTransfer <never, ValidationError, never> (side-effect)"]
  n3["rate <- deps.fetchRate <ExchangeRate, RateUnavailableError, never> (side-effect)"]
  n4["balance <- deps.getBalance <number, never, never> (side-effect)"]
  n5["converted <- deps.convertCurrency <ConvertedAmount, InsufficientFundsError, never> (side-effect)"]
  n6["transfer <- deps.executeTransfer <( transferId: string; ), TransferRejectedError &#124; ProviderUnavailableError, never> (side-effect)"]
  n7["deps.sendConfirmation <void, ConfirmationFailedError, never> (side-effect)"]

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

- **Total Effects**: 13

## Explanation

```
createSendMoneyWorkflow (generator):
  1. Yields validated <- deps.validateTransfer
  2. Yields rate <- deps.fetchRate
  3. Yields balance <- deps.getBalance
  4. Yields converted <- deps.convertCurrency
  5. Yields transfer <- deps.executeTransfer
  6. Calls deps.sendConfirmation

  Error paths: ConfirmationFailedError, InsufficientFundsError, ProviderUnavailableError, RateUnavailableError, TransferRejectedError, ValidationError
  Concurrency: sequential (no parallelism)
```

## Error Types

- `ConfirmationFailedError`
- `InsufficientFundsError`
- `ProviderUnavailableError`
- `RateUnavailableError`
- `TransferRejectedError`
- `ValidationError`
