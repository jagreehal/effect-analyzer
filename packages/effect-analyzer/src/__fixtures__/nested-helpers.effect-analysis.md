# Effect Analysis: normalizeEmail

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/nested-helpers.ts`
- **Analyzed**: 2026-05-22T16:10:33.222Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: normalizeEmail

  start((Start))
  end_node((End))

  n1["Generator (0 yields)"]

  %% Edges
  start --> n1
  n1 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef generatorStyle fill:#FFB6C1,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 generatorStyle
```


## Statistics

- No operations found


## Explanation

```
normalizeEmail (generator):


  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: persistUser

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/nested-helpers.ts`
- **Analyzed**: 2026-05-22T16:10:33.224Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: persistUser

  start((Start))
  end_node((End))

  n2["log (side-effect)"]

  %% Edges
  start --> n2
  n2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
persistUser (generator):
  1. Calls log

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: nestedHelperProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/nested-helpers.ts`
- **Analyzed**: 2026-05-22T16:10:33.225Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: nestedHelperProgram

  start((Start))
  end_node((End))

  n2["parsed <- parseInput (side-effect)"]
  n3["normalized <- normalizeEmail (side-effect)"]
  n4["user <- persistUser (side-effect)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  start --> n2
  n4 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 effectStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
nestedHelperProgram (generator):
  1. Yields parsed <- parseInput
  2. Yields normalized <- normalizeEmail
  3. Yields user <- persistUser

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`



---

# Effect Analysis: parseInput

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/nested-helpers.ts`
- **Analyzed**: 2026-05-22T16:10:33.225Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: parseInput

  start((Start))
  end_node((End))

  n1["try"]

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
parseInput (direct):
  1. Calls try — constructor

  Error paths: Error
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`

