# Effect Analysis: requireItem

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/utility-effect-functions.ts`
- **Analyzed**: 2026-05-22T16:10:34.861Z
- **Source Type**: functionDeclaration
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: requireItem

  start((Start))
  end_node((End))

  n1["succeed"]
  n2["fail"]

  %% Edges
  n1 --> n2
  start --> n1
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 effectStyle
  class n2 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
requireItem (functionDeclaration):
  1. Calls succeed — constructor
  2. Calls fail — constructor

  Error paths: NotFoundError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `NotFoundError`



---

# Effect Analysis: validateInput

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/utility-effect-functions.ts`
- **Analyzed**: 2026-05-22T16:10:34.862Z
- **Source Type**: functionDeclaration
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: validateInput

  start((Start))
  end_node((End))

  n1["fail"]
  n2["succeed"]

  %% Edges
  n1 --> n2
  start --> n1
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 effectStyle
  class n2 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
validateInput (functionDeclaration):
  1. Calls fail — constructor
  2. Calls succeed — constructor

  Error paths: string
  Concurrency: sequential (no parallelism)
```


## Error Types

- `string`

