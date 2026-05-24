# Effect Analysis: pipeWithSpan

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/generic-e-resolution.ts`
- **Analyzed**: 2026-05-22T16:10:32.506Z
- **Source Type**: pipe
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: pipeWithSpan

  start((Start))
  end_node((End))

  n1["Pipe (0 steps)"]
  n2["succeed"]

  %% Edges
  n1 --> n2
  start --> n1
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 pipeStyle
  class n2 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
pipeWithSpan (pipe):
  1. Pipes succeed through:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: inner

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/generic-e-resolution.ts`
- **Analyzed**: 2026-05-22T16:10:32.506Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: inner

  start((Start))
  end_node((End))

  n1["fail"]

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
inner (direct):
  1. Calls fail — constructor

  Error paths: "oops"
  Concurrency: sequential (no parallelism)
```


## Error Types

- `"oops"`



---

# Effect Analysis: curriedWithSpan

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/generic-e-resolution.ts`
- **Analyzed**: 2026-05-22T16:10:32.506Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: curriedWithSpan

  start((Start))
  end_node((End))

  n1["withSpan (side-effect)"]

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
curriedWithSpan (direct):
  1. Calls withSpan

  Error paths: "oops"
  Concurrency: sequential (no parallelism)
```


## Error Types

- `"oops"`

