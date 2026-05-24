# Effect Analysis: ifElseProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.674Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ifElseProgram

  start((Start))
  end_node((End))

  n2["user <- succeed"]
  decision_4{"user.isPremium"}
  n5["succeed"]
  n6["succeed"]

  %% Edges
  decision_4 -->|yes| n5
  decision_4 -->|no| n6
  n2 --> decision_4
  start --> n2
  n5 --> end_node
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class decision_4 decisionStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
ifElseProgram (generator):
  1. Yields user <- succeed
  2. If user.isPremium:
    Calls succeed — constructor
  3. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: switchProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.676Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: switchProgram

  start((Start))
  end_node((End))

  n2["tier <- succeed"]
  n3["Switch: tier"]
  switch_4{"Switch: tier"}
  n5["succeed"]
  n6["succeed"]
  n7["succeed"]
  switchWarn_8{{"⚠ fallthrough"}}

  %% Edges
  switch_4 -->|'gold'| n5
  switch_4 -->|'silver'| n6
  switch_4 -->|default| n7
  switch_4 -->|note| switchWarn_8
  n2 --> switch_4
  start --> n2
  n5 --> end_node
  n6 --> end_node
  n7 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef switchStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef opaqueStyle fill:#FF9800,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 switchStyle
  class switch_4 switchStyle
  class n5 effectStyle
  class n6 effectStyle
  class n7 effectStyle
  class switchWarn_8 opaqueStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
switchProgram (generator):
  1. Yields tier <- succeed
  2. Switch on tier:
    Case 'gold':
      Calls succeed — constructor
    Case 'silver':
      Calls succeed — constructor
    Case default:
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: forOfProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.677Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: forOfProgram

  start((Start))
  end_node((End))

  n2["forOf(items)"]
  loop_3(["forOf(items)"])
  n4["succeed"]

  %% Edges
  n2 --> loop_3
  loop_3 -->|iterate| n4
  n4 -->|next| loop_3
  start --> n2
  loop_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 loopStyle
  class loop_3 loopStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 1
- **Loops**: 1


## Explanation

```
forOfProgram (generator):
  1. Iterates (forOf) over items:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: whileProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.678Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: whileProgram

  start((Start))
  end_node((End))

  n2["while(i < 3)"]
  loop_3(["while(i < 3)"])
  n4["succeed"]

  %% Edges
  n2 --> loop_3
  loop_3 -->|iterate| n4
  n4 -->|next| loop_3
  start --> n2
  loop_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 loopStyle
  class loop_3 loopStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 1
- **Loops**: 1


## Explanation

```
whileProgram (generator):
  1. Iterates (while) over i < 3:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: tryCatchProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.679Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: tryCatchProgram

  start((Start))
  end_node((End))

  n2["Try/Catch"]
  n3["succeed"]
  catch_4["Catch(e)"]
  n5["succeed"]
  n6["succeed"]

  %% Edges
  n3 -->|on error| catch_4
  catch_4 --> n5
  n3 -->|finally| n6
  n5 -->|finally| n6
  start --> n3
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef tryCatchStyle fill:#FFE4B5,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 tryCatchStyle
  class n3 effectStyle
  class catch_4 tryCatchStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
tryCatchProgram (generator):
  1. Try:
    Calls succeed — constructor
  2. Catch:
    Calls succeed — constructor
  3. Finally:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: returnYieldProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.681Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: returnYieldProgram

  start((Start))
  end_node((End))

  n2["x <- succeed"]
  decision_4{"x > 0"}
  n5["return"]
  term_6(["return"])
  n7["succeed"]
  n8["succeed"]

  %% Edges
  n5 --> n7
  n7 --> term_6
  decision_4 -->|yes| n5
  n2 --> decision_4
  decision_4 --> n8
  start --> n2
  n8 --> end_node

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
  class n8 effectStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
returnYieldProgram (generator):
  1. Yields x <- succeed
  2. If x > 0:
    Returns:
      Calls succeed — constructor
  3. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: nestedProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.682Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: nestedProgram

  start((Start))
  end_node((End))

  n2["user <- succeed"]
  decision_4{"user.isPremium"}
  n5["Switch: user.tier"]
  switch_6{"Switch: user.tier"}
  n7["succeed"]
  n8["succeed"]
  n9["succeed"]

  %% Edges
  switch_6 -->|'gold'| n7
  switch_6 -->|'silver'| n8
  decision_4 -->|yes| switch_6
  decision_4 -->|no| n9
  n2 --> decision_4
  start --> n2
  n7 --> end_node
  n8 --> end_node
  n9 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  classDef switchStyle fill:#FFD700,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class decision_4 decisionStyle
  class n5 switchStyle
  class switch_6 switchStyle
  class n7 effectStyle
  class n8 effectStyle
  class n9 effectStyle
```


## Statistics

- **Total Effects**: 4


## Explanation

```
nestedProgram (generator):
  1. Yields user <- succeed
  2. If user.isPremium:
    Switch on user.tier:
      Case 'gold':
        Calls succeed — constructor
      Case 'silver':
        Calls succeed — constructor
  3. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: ternaryProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.684Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: ternaryProgram

  start((Start))
  end_node((End))

  decision_3{"true"}
  n4["succeed"]
  n5["succeed"]

  %% Edges
  decision_3 -->|yes| n4
  decision_3 -->|no| n5
  start --> decision_3
  n4 --> end_node
  n5 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class decision_3 decisionStyle
  class n4 effectStyle
  class n5 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
ternaryProgram (generator):
  1. result = If isPremium:
    Calls succeed — constructor
  2. Else:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: shortCircuitProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.685Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: shortCircuitProgram

  start((Start))
  end_node((End))

  decision_3{"true"}
  n4["succeed"]

  %% Edges
  decision_3 -->|yes| n4
  start --> decision_3
  n4 --> end_node
  decision_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef decisionStyle fill:#DDA0DD,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class decision_3 decisionStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 1


## Explanation

```
shortCircuitProgram (generator):
  1. y = If x:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: nestedFunctionProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.685Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: nestedFunctionProgram

  start((Start))
  end_node((End))

  n2["succeed"]
  n3["succeed"]

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
nestedFunctionProgram (generator):
  1. Calls succeed — constructor
  2. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: fn

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.686Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: fn

  start((Start))
  end_node((End))

  n2["succeed"]

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
fn (generator):
  1. Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: fallthroughProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.687Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: fallthroughProgram

  start((Start))
  end_node((End))

  n2["x <- succeed"]
  n3["Switch: x"]
  switch_4{"Switch: x"}
  n5["succeed"]
  n6["succeed"]
  switchWarn_7{{"⚠ fallthrough"}}

  %% Edges
  switch_4 -->|1 / 2| n5
  switch_4 -->|3| n6
  switch_4 -->|note| switchWarn_7
  n2 --> switch_4
  start --> n2
  n5 --> end_node
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef switchStyle fill:#FFD700,stroke:#333,stroke-width:2px
  classDef opaqueStyle fill:#FF9800,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 effectStyle
  class n3 switchStyle
  class switch_4 switchStyle
  class n5 effectStyle
  class n6 effectStyle
  class switchWarn_7 opaqueStyle
```


## Statistics

- **Total Effects**: 3


## Explanation

```
fallthroughProgram (generator):
  1. Yields x <- succeed
  2. Switch on x:
    Case 1, 2:
      Calls succeed — constructor
    Case 3:
      Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: tryFinallyReturnProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.688Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: tryFinallyReturnProgram

  start((Start))
  end_node((End))

  n2["Try/Catch"]
  n3["return"]
  term_4(["return"])
  n5["succeed"]
  n6["succeed"]

  %% Edges
  n3 --> n5
  n5 --> term_4
  start --> n3
  n6 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef tryCatchStyle fill:#FFE4B5,stroke:#333,stroke-width:2px
  classDef terminalStyle fill:#FF6B6B,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 tryCatchStyle
  class n3 terminalStyle
  class term_4 terminalStyle
  class n5 effectStyle
  class n6 effectStyle
```


## Statistics

- **Total Effects**: 2


## Explanation

```
tryFinallyReturnProgram (generator):
  1. Try:
    Returns:
      Calls succeed — constructor
  2. Finally:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```



---

# Effect Analysis: doWhileProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-gen.ts`
- **Analyzed**: 2026-05-22T16:10:30.689Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: doWhileProgram

  start((Start))
  end_node((End))

  n2["doWhile(count < 3)"]
  loop_3(["doWhile(count < 3)"])
  n4["succeed"]

  %% Edges
  n2 --> loop_3
  loop_3 -->|iterate| n4
  n4 -->|next| loop_3
  start --> n2
  loop_3 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef loopStyle fill:#F0E68C,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 loopStyle
  class loop_3 loopStyle
  class n4 effectStyle
```


## Statistics

- **Total Effects**: 1
- **Loops**: 1


## Explanation

```
doWhileProgram (generator):
  1. Iterates (doWhile) over count < 3:
    Calls succeed — constructor

  Concurrency: sequential (no parallelism)
```

