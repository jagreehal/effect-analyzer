# Effect Analysis: build

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/regression-internal-aliases.ts`
- **Analyzed**: 2026-05-22T16:10:33.934Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: build

  start((Start))
  end_node((End))

  n1["internalLayer.build (service-call) R: InternalLayer"]

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
build (direct):
  1. Calls InternalLayer.build — service-call

  Services required: InternalLayer
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `InternalLayer`: InternalLayer



---

# Effect Analysis: subscribe

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/regression-internal-aliases.ts`
- **Analyzed**: 2026-05-22T16:10:33.934Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: subscribe

  start((Start))
  end_node((End))

  n1["internalPubSub.subscribe (service-call) R: InternalPubSub"]

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
subscribe (direct):
  1. Calls InternalPubSub.subscribe — service-call

  Services required: InternalPubSub
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `InternalPubSub`: InternalPubSub

