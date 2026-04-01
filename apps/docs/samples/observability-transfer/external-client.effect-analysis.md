# Effect Analysis: external-client.ts

## Program 1: fetchRatesFromApi

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/external-client.ts`
- **Analyzed**: 2026-04-01T19:18:08.635Z
- **Source Type**: direct

## Effect Flow

```mermaid
flowchart TB

  %% Program: fetchRatesFromApi

  start((Start))
  end_node((End))

  n1["trace (side-effect)"]

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
fetchRatesFromApi (direct):
  1. Calls trace

  Concurrency: sequential (no parallelism)
```

## Program 2: postTransferToProvider

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/external-client.ts`
- **Analyzed**: 2026-04-01T19:18:08.635Z
- **Source Type**: direct

## Effect Flow

```mermaid
flowchart TB

  %% Program: postTransferToProvider

  start((Start))
  end_node((End))

  n1["trace (side-effect)"]

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
postTransferToProvider (direct):
  1. Calls trace

  Concurrency: sequential (no parallelism)
```

## Program 3: sendNotification

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/apps/docs/samples/observability-transfer/external-client.ts`
- **Analyzed**: 2026-04-01T19:18:08.636Z
- **Source Type**: direct

## Effect Flow

```mermaid
flowchart TB

  %% Program: sendNotification

  start((Start))
  end_node((End))

  n1["trace (side-effect)"]

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
sendNotification (direct):
  1. Calls trace

  Concurrency: sequential (no parallelism)
```
