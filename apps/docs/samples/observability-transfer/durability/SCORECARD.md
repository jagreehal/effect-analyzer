# State-machine durability scorecard

Falsifiable claim:

> A developer can express a multi-state Effect workflow with the documented
> conventions, keep the machine complete under
> `--format statechart-coverage --min-coverage N`, and a deliberately incomplete
> change fails CI before merge.

Date: 2026-07-21  
Sample: [`../transfer-lifecycle.ts`](../transfer-lifecycle.ts)  
Gate: `--format statechart-coverage --min-coverage 80`

## Adoption (dogfood)

| Check | Result |
|-------|--------|
| Machine discovered by CLI | Pass — `transferLifecycle` (transition-table) |
| Alphabet resolves | Pass — `tagged-union` |
| Clean coverage ≥ 80% | Pass — **90%** (9/10 pairs) |
| Undocumented workarounds needed | None — `@initial`, `satisfies`, `invoke`, guards, `type: 'final'` as documented |

Design note: a sparse linear alphabet (one unique event per stage) scores poorly
under the (active-state × declared-event) metric. The dogfood machine uses dense
`Advance` / `Fail` events so the threshold is meaningful. That is a product
insight about the metric, not a workaround.

## Seeded-bug matrix (gate value)

Command for each:

```bash
node packages/effect-analyzer/dist/cli.js <file> --format statechart-coverage --min-coverage 80
```

| Seed | File | Expected | Actual exit | Actual findings | Pass? |
|------|------|----------|-------------|-----------------|-------|
| Clean | `../transfer-lifecycle.ts` | 0 | **0** | 0 warnings, 90% | Yes |
| A: remove Advance from Validating | [`seed-missing-advance.ts`](seed-missing-advance.ts) | non-zero | **1** | 5 unreachable + 50% below threshold | Yes |
| B: declared Cancelled never targeted | [`seed-unreachable.ts`](seed-unreachable.ts) | non-zero | **1** | `unreachable-state: Cancelled` | Yes |
| C: typo target `Executng` | [`seed-undeclared-typo.ts`](seed-undeclared-typo.ts) | non-zero | **1** | undeclared `Executng` + unreachable successors | Yes |

Seed C note: coverage rose to 100% because broken successors left the active
set — warnings alone still failed the gate. The gate is not coverage-%-only.

## CI

[`.github/workflows/ci.yml`](../../../../../.github/workflows/ci.yml) runs the
clean gate on `transfer-lifecycle.ts` only (not this `durability/` folder, which
intentionally contains failing seeds).

## Verdict

**Claim supported** for dogfood + CLI gate:

- Dogfood machine exists beside the Effect transfer workflow
- Clean gate exits 0 at `--min-coverage 80`
- Every seeded bug exited non-zero as predicted
- No critical undocumented constraints surfaced

Revisit if real external workflows need sparse per-stage events and cannot hit
a high `--min-coverage` without padding transitions.
