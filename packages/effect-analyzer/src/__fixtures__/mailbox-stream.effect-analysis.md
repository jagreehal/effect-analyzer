# Effect Analysis: mailboxProgram

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/mailbox-stream.ts`
- **Analyzed**: 2026-05-22T16:10:32.986Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: mailboxProgram

  start((Start))
  end_node((End))

  n2["mailbox.create (concurrency)"]
  n3["mailbox.offer (concurrency)"]
  n4["mailbox.take (concurrency)"]
  n5["mailbox.takeAll (concurrency)"]
  n6["mailbox.end (concurrency)"]
  n7["Stream (stream)"]
  n8["mailbox.toStream (concurrency)"]

  %% Edges
  n2 --> n3
  n3 --> n4
  n4 --> n5
  n5 --> n6
  n7 --> n8
  n6 --> n7
  start --> n2
  n8 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef streamStyle fill:#E0F7FA,stroke:#333,stroke-width:2px
  classDef concurrencyPrimitiveStyle fill:#B0E0E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 concurrencyPrimitiveStyle
  class n3 concurrencyPrimitiveStyle
  class n4 concurrencyPrimitiveStyle
  class n5 concurrencyPrimitiveStyle
  class n6 concurrencyPrimitiveStyle
  class n7 streamStyle
  class n8 concurrencyPrimitiveStyle
```


## Statistics

- No operations found


## Explanation

```
mailboxProgram (generator):
  1. mailbox = mailbox.create
  2. mailbox.offer
  3. msg = mailbox.take
  4. all = mailbox.takeAll
  5. mailbox.end
  6. Stream: 
    mailbox.toStream

  Concurrency: sequential (no parallelism)
```

