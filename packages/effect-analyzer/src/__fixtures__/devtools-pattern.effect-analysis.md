# Effect Analysis: devProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/devtools-pattern.ts`
- **Analyzed**: 2026-05-22T16:10:31.072Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: devProgram

  start((Start))
  end_node((End))

  n2["DevTools.layer (service-call) R: DevTools"]
  n3["Server.listen (side-effect)"]

  %% Edges
  n2 --> n3
  start --> n2
  n3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
devProgram (generator):
  1. Calls DevTools.layer — service-call
  2. Calls Server.listen — devtools

  Services required: DevTools, Server.listen
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `DevTools`: DevTools
- `Server.listen`

