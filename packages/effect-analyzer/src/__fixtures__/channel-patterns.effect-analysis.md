# Effect Analysis: channelProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/channel-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:29.947Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: channelProgram

  start((Start))
  end_node((End))

  n1["Stream → make → pipeThroughChannel (stream)"]
  n2["Unknown: Could not determine effect type"]

  %% Edges
  n1 --> n2
  start --> n1
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef streamStyle fill:#E0F7FA,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n1 streamStyle
  class n2 unknownStyle
```


## Statistics

- **Unknown Nodes**: 1


## Explanation

```
channelProgram (direct):
  1. Stream: make -> pipeThroughChannel
    (unknown: Could not determine effect type)

  Concurrency: sequential (no parallelism)
```

