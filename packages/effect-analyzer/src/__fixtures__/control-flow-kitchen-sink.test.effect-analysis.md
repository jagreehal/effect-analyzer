# Effect Analysis: run-1

## Metadata

- **File**: `/Users/jreehal/dev/node-examples/effect-analyzer/packages/effect-analyzer/src/__fixtures__/control-flow-kitchen-sink.test.ts`
- **Analyzed**: 2026-05-22T16:10:30.785Z
- **Source Type**: run
- **TypeScript Version**: 6.0.2


## Effect Flow

```mermaid
flowchart TB

  %% Program: run-1

  start((Start))
  end_node((End))

  n1["analyze(FIXTURE_PATH).all (0) (concurrency)"]
  parallel_fork_2{{"All (0)"}}
  parallel_join_2{{"Join"}}

  %% Edges
  n1 --> parallel_fork_2
  start --> n1
  parallel_join_2 --> end_node

  %% Styles
  classDef startStyle fill:#c8e6c9,stroke:#2e7d32
  classDef endStyle fill:#ffcdd2,stroke:#c62828
  classDef parallelStyle fill:#FFA500,stroke:#333,stroke-width:2px
  class start startStyle
  class end_node endStyle
  class n1 parallelStyle
  class parallel_fork_2 parallelStyle
  class parallel_join_2 parallelStyle
```


## Statistics

- **Parallel Operations**: 1


## Explanation

```
run-1 (run):
  1. Runs 0 effects in sequential:

  Concurrency: uses parallelism / racing
```

