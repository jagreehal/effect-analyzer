# Effect Analysis: prog

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/rc-ref-reloadable.ts`
- **Analyzed**: 2026-05-22T16:10:33.579Z
- **Source Type**: generator
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: prog

  start((Start))
  end_node((End))

  n2["rcRef.create (concurrency)"]
  n3["Pipe (1 steps)"]
  n4["ref"]
  n5["RcRef.get (service-call) R: '/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef'"]
  n6["reloadable.create (concurrency)"]
  n7["Pipe (1 steps)"]
  n8["rel"]
  n9["Reloadable.get (service-call) R: __object"]
  n10["Pipe (1 steps)"]
  n11["rel"]
  n12["Reloadable.reload (service-call) R: __object"]

  %% Edges
  n4 --> n5
  n3 --> n4
  n2 --> n3
  n5 --> n6
  n8 --> n9
  n7 --> n8
  n6 --> n7
  n11 --> n12
  n10 --> n11
  n9 --> n10
  start --> n2
  n12 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef effectStyle fill:#90EE90,stroke:#333,stroke-width:2px
  classDef pipeStyle fill:#ADD8E6,stroke:#333,stroke-width:2px
  classDef concurrencyPrimitiveStyle fill:#B0E0E6,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n2 concurrencyPrimitiveStyle
  class n3 pipeStyle
  class n4 effectStyle
  class n5 effectStyle
  class n6 concurrencyPrimitiveStyle
  class n7 pipeStyle
  class n8 effectStyle
  class n9 effectStyle
  class n10 pipeStyle
  class n11 effectStyle
  class n12 effectStyle
```


## Statistics

- **Total Effects**: 6


## Explanation

```
prog (generator):
  1. ref = rcRef.create
  2. n = Pipes ref through:
    Calls ref
    Calls "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef".get — service-call
  3. rel = reloadable.create
  4. v = Pipes rel through:
    Calls rel
    Calls __object.get — service-call
  5. Pipes rel through:
    Calls rel
    Calls __object.reload — service-call

  Services required: "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef", __object
  Concurrency: sequential (no parallelism)
```


## Dependencies

- `"/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef"`: "/Users/jreehal/dev/node-examples/effect-analyzer/node_modules/.pnpm/effect@3.21.2/node_modules/effect/dist/dts/RcRef"
- `__object`: __object

