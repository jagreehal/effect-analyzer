# XState + Effect workflows

Machines built with `@xstate/effect@1.0.0-alpha.10` and `xstate@6.0.0-alpha.71`,
for trying the statechart outputs. MIT licensed, see [LICENSE](./LICENSE).

| File                                      | What the analyzer reads                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `approval.ts`                             | `setupEffect().createMachine`: `after` timer, `invoke` with a transition-function `onDone`, final states |
| `parallel.ts`                             | `createMachine` with a parallel root and two regions                                                     |
| `resources.ts`                            | `setup().createMachine` invoking a `createEffectLogic` actor                                             |
| `failure-cause.ts`                        | Block-bodied `onError` transition function                                                               |
| `retry.ts`, `supervision.ts`, `errors.ts` | Effect retry, scoped supervision and typed errors around actors                                          |

```bash
# From the repo root, after `pnpm build`:
node packages/effect-analyzer/dist/cli.js examples/xstate-effect-workflows/approval.ts --format statechart-html
```

`packages/effect-analyzer/src/state-machine-xstate.test.ts` pins the extracted
machines, and `pnpm tc:examples` type-checks the files.
