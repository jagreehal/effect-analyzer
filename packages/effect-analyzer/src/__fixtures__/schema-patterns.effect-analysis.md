# Effect Analysis: validateUserProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.228Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: validateUserProgram

  start((Start))
  end_node((End))

  n2["user <- decodeUnknown (side-effect)"]
  n3["catchTag (error-handler)"]
  n4["Effect"]
  err_handler_5["catchTag"]
  n6["Unknown: Could not determine effect type"]

  %% Edges
  n4 -->|on ParseError| err_handler_5
  err_handler_5 --> n6
  n2 --> n4
  start --> n2
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef errorHandlerStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef unknownStyle fill:#D3D3D3,stroke:#333,stroke-width:1px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 errorHandlerStyle
  class n4 effectStyle
  class err_handler_5 errorHandlerStyle
  class n6 unknownStyle
```


## Statistics

- **Total Effects**: 2
- **Error Handlers**: 1
- **Unknown Nodes**: 1


## Explanation

```
validateUserProgram (generator):
  1. Yields user <- decodeUnknown

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: encodeUserProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.241Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: encodeUserProgram

  start((Start))
  end_node((End))

  n2["encoded <- encode (side-effect)"]

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
encodeUserProgram (generator):
  1. Yields encoded <- encode

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: processApiResponseProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.253Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: processApiResponseProgram

  start((Start))
  end_node((End))

  n2["parsed <- decodeUnknown (side-effect)"]
  decision_4{"parsed._tag === 'success'"}
  n5["return"]
  term_6(["return"])
  n7["fail"]

  %% Edges
  n5 --> n7
  n7 --> term_6
  decision_4 -->|no| n5
  n2 --> decision_4
  start --> n2
  n2 --> end_node

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
processApiResponseProgram (generator):
  1. Yields parsed <- decodeUnknown
  2. If parsed._tag === 'success':
  3. Else:
    Returns:
      Calls fail — constructor

  Error paths: Error, ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `Error`
- `ParseError`



---

# Effect Analysis: createUserIdProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.255Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: createUserIdProgram

  start((Start))
  end_node((End))

  n2["validated <- decode (side-effect)"]

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
createUserIdProgram (generator):
  1. Yields validated <- decode

  Error paths: ParseError
  Concurrency: sequential (no parallelism)
```


## Error Types

- `ParseError`



---

# Effect Analysis: EmailSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.256Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: EmailSchema

  start((Start))
  end_node((End))

  n1["pipe (side-effect)"]

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
EmailSchema (direct):
  1. Calls pipe — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: PositiveInt

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.256Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: PositiveInt

  start((Start))
  end_node((End))

  n1["pipe (side-effect)"]

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
PositiveInt (direct):
  1. Calls pipe — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserId

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.257Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserId

  start((Start))
  end_node((End))

  n1["pipe (side-effect)"]

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
UserId (direct):
  1. Calls pipe — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: AddressSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.257Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: AddressSchema

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
AddressSchema (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: UserSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.258Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: UserSchema

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
UserSchema (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: CreateUserRequest

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.259Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: CreateUserRequest

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
CreateUserRequest (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: StatusSchema

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.260Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: StatusSchema

  start((Start))
  end_node((End))

  n1["Literal (side-effect)"]

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
StatusSchema (direct):
  1. Calls Literal — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ApiResponse

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.260Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ApiResponse

  start((Start))
  end_node((End))

  n1["Union (side-effect)"]

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
ApiResponse (direct):
  1. Calls Union — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ValidationError

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.262Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ValidationError

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
ValidationError (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: GetUserRequest

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.263Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: GetUserRequest

  start((Start))
  end_node((End))

  n1["Struct (side-effect)"]

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
GetUserRequest (direct):
  1. Calls Struct — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: DateFromString

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.265Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: DateFromString

  start((Start))
  end_node((End))

  n1["transform (side-effect)"]

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
DateFromString (direct):
  1. Calls transform — schema

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: TrimmedString

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/schema-patterns.ts`
- **Analyzed**: 2026-05-22T16:10:34.266Z
- **Source Type**: direct
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: TrimmedString

  start((Start))
  end_node((End))

  n1["pipe (side-effect)"]

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
TrimmedString (direct):
  1. Calls pipe — schema

  Concurrency: sequential (no parallelism)
```

