# Effect Analyzer Domain Context

## Terms

### Analysis session

One configured run of source analysis. It owns TypeScript project creation,
`ts-morph` loading, caches, analyzer options, recursive expression analysis,
warnings, and statistics. Callers must not initialize those concerns separately.

### Project corpus

The result of discovering and analyzing a project once. It records every source
file, its Effect IR programs, zero-program outcome, failure, and optional timing.
Project reports derive their views from this shared evidence instead of scanning
the same files again.

### Audit assessment

Named measurements derived from a project corpus. Each measurement carries its
numerator, denominator, and rate so Effect adoption, analyzer success, and IR
resolution cannot be confused with one another.

### Audit policy

Explicit CI expectations evaluated against an audit assessment. Policy produces
typed violations and a pass or fail decision without changing the underlying
measurements.

### Effect IR

The static intermediate representation of an Effect program. It is the shared
source of truth for diagnostics, diagrams, reports, diffs, and runtime overlays.

### Diagram fidelity

Whether a diagram is an honest representation of the source program. Fidelity
is independent of readability: a large diagram may be exact, while a small
diagram containing unresolved or ambiguously identified nodes is not.

### Fidelity finding

A located fact explaining why Effect IR may not represent source structure or
join runtime spans exactly. Project audits aggregate these findings; diagram and
runtime views retain their individual locations and reasons.

### Static identity

The stable identity assigned to an Effect IR node from explicit program
structure. Source locations may disambiguate static nodes but are not runtime
identities.

### Span path

The ordered names of nested Effect spans from a trace root to an executed span.
It is the join key between Effect IR and runtime traces. A path is exact only
when every segment is statically known and unique among its siblings.

### Runtime overlay

A static diagram annotated with observations from one execution, including
status, duration, and unmatched or ambiguous spans.

## Supported Effect version

The analyzer supports Effect v4 only. Compatibility with Effect v3 is not a
constraint, and breaking changes that deepen the package interface are allowed.
