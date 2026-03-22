# effect-analyzer

## 0.1.1

### Patch Changes

- f68fa1a: Tighten `Effect.gen` call detection: require the callee to end with `.gen` instead of matching `.gen` anywhere in the expression text, so unrelated identifiers are not mistaken for `gen` programs.
