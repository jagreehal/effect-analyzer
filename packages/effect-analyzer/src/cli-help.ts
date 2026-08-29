/**
 * `--help` text.
 *
 * Lives apart from the CLI itself: it is a long literal that changes whenever a
 * flag is added, and it has no dependency on anything the CLI does.
 *
 * Exported as a value so `cli-help.test.ts` can hold it against the parser's
 * own flag table. Being a separate literal from the parser is what let the two
 * drift apart in the first place.
 */

export const HELP_TEXT = `
effect-analyzer - Static analysis for Effect-TS

Usage: effect-analyze [PATH] [options]

  PATH is optional and defaults to the current directory (.).
  When PATH is a directory: analyzes all TypeScript files and writes colocated
  .effect-analysis.md next to each file that contains Effect programs (gold-tier:
  verbose output, enhanced Mermaid, colors). Use --no-colocate to skip writing files.

Options:
  -f, --format <format>    Output format: auto | json | mermaid | mermaid-paths | mermaid-enhanced | mermaid-railway | mermaid-services | mermaid-errors | mermaid-decisions | mermaid-causes | mermaid-concurrency | mermaid-timeline | mermaid-layers | mermaid-retry | mermaid-testability | mermaid-dataflow | mermaid-statechart | svg-statechart | statechart-html | xstate-config | statechart-coverage | stats | migration | showcase | explain | summary | matrix | architecture | api-docs | openapi-paths | openapi-runtime | json-schema (default: auto)
  --export <name>          For openapi-runtime: export name of HttpApi (default: first/default)
                           For json-schema: export name of the Schema to convert (required)
  -o, --output <file>      Output file (default: stdout)
  -d, --direction <dir>    Mermaid diagram direction: TB | LR | BT | RL (default: TB)
  --detail <level>         Mermaid detail level: compact | standard | verbose (default: auto based on size)
  -c, --compact            Compact output (no formatting)
  --pretty                 Pretty-print output (default; overrides --compact)
  --tsconfig <path>        Path to tsconfig.json for resolution (e.g. when analyzing external repo)
  --no-metadata            Exclude metadata from output
  --colocate               (Single file) Write analysis next to source as markdown
  --no-colocate            (Project mode) Do not write colocated files; print summary only
  --no-colocate-enhanced   Use standard Mermaid in colocated docs (default: enhanced)
  --colocate-suffix <s>    Suffix for colocated files (default: "effect-analysis")
                           Result: foo/bar.ts -> foo/bar.effect-analysis.md
  -q, --quiet              Minimal output (no per-file lines)
  --no-color               Disable colored output
  -w, --watch              Watch mode: re-analyze on file change
  -m, --migration          Run migration assistant (report try/catch, Promise.*, etc.)
  --include-trivial        Keep trivial programs that are filtered from diagrams by default
  --diff                   Compare two sources and report the structural change between them.
                           Each source is <git-ref>:<path> or a plain path:
                           effect-analyze --diff HEAD:./src/a.ts main:./src/a.ts
  --regression             With --diff: mark structural changes as regressions in the report
  --entry-points           (Single file) Report the program entry points the analyzer found
  --config-leaks           (Single file) Report configuration read outside a Config boundary
  --cli-commands           (Single file) Report the CLI command surface the file defines
  --coverage-audit         Run coverage audit on a directory (discovered/analyzed/failed, %%)
  --show-suspicious-zeros  With --coverage-audit: list files that import Effect but have 0 programs
  --show-top-unknown       With --coverage-audit: list top files by unknown node rate (default: on)
  --no-show-top-unknown    Disable top-unknown output (e.g. for minimal CI output)
  --show-top-unknown-reasons  With --coverage-audit: list top unknown node reasons (default: on)
  --no-show-top-unknown-reasons  Disable top-unknown-reasons output
  --show-by-folder         With --coverage-audit: show ok/zero/fail counts by top-level folder
  --per-file-timing        With --coverage-audit: include per-file durationMs in audit (optional timing)
  --min-meaningful-nodes <n>  Filter analyzed programs with fewer than n non-unknown nodes (public-output mode)
  --min-coverage <n>       With --format statechart-coverage: fail (exit 1) if any machine is below n%% coverage
  --coverage-json          With --format statechart-coverage: emit JSON ({ machines, summary }) for dashboards
  --open                   With --format statechart-html/svg-statechart: open the written HTML in your browser
  --exclude-from-suspicious-zero <pattern>  With --coverage-audit: exclude paths matching pattern from suspicious zeros (repeatable)
  --known-effect-internals-root <path>      With --coverage-audit: treat local imports under path as Effect (improve.md §1)
  --max-audit-failed-files <n>              Fail the audit when analysis failures exceed n
  --max-audit-suspicious-zeros <n>          Fail the audit when suspicious zero-program files exceed n
  --min-audit-effect-adoption <percent>     Fail when Effect-bearing files fall below this share of discovered files
  --min-audit-source-resolution <percent>   Fail when resolved IR nodes fall below this share of all IR nodes
  --json-summary           With --coverage-audit: print only audit JSON to stdout (CI mode)
  --quality                Add heuristic diagram readability estimate and top offenders report
  --assert-diagram-fidelity  Fail when unresolved, opaque, dynamic-span, or ambiguous-span nodes make a diagram inexact
  --quality-eslint <path>  Ingest existing ESLint JSON for optional quality hints
  --style-guide            Apply summary-style rendering heuristics (default: on for --format mermaid-paths)
  --no-style-guide         Disable style-guide (e.g. for plain mermaid-paths output)
  --service-map            Build deduplicated service map (default: on)
  --no-service-map         Disable service map
  --test                   Write a {programName}.test.ts stub next to each source file (skips existing files unless --test-overwrite)
  --test-runner <runner>   Test runner for --test: vitest (default) | jest | mocha
  --test-overwrite         With --test: overwrite existing test files instead of skipping
  --no-test                Disable an earlier --test (e.g. from a shared alias or script)
  --cache                  Use cache for watch (future: persist IR)
  --list-rules             Print deterministic rule registry docs (source/effect-lint/strict)
  --index-rules            Print deterministic searchable rule index entries
  --search-rules <query>   Search rules by code/title/description/example
  --explain-rule <code>    Show one rule in detail
  --profile <name>         Rule profile: strict | ci | migration | docs
  --export-session <file>  Export CLI session envelope (inputs/options/results metadata)
  --import-session <file>  Import and print previously exported session envelope
  --max-files <n>          Analyze at most n files (cursor-window mode)
  --cursor <n>             Start from nth file in sorted file list (resumable window)
  --lint-source            Run deterministic source lints on a file or directory
  --tsgo[=<tsconfig>]      Merge type-aware Effect diagnostics from @effect/tsgo
                           using the target project's TypeScript 7 installation
  --sarif                  Emit SARIF 2.1.0 output (for --lint-source)
  --baseline <file>        Compare findings against a baseline session/json file
  --fail-on-new            Exit non-zero when new findings exist vs baseline
  --require-suppression-reason  Require a reason after disable-next-line suppression comments
  --fail-on-stale-suppressions  Exit non-zero when disable-next-line suppressions are stale
  --service-cycles         Analyze project service map and output detected dependency cycles
  --bundle-output <dir>    Write deterministic artifact bundle (diagnostics, sarif, summary, rules, session)
  --scorecard              Emit deterministic per-file lint scorecard (for --lint-source)
  --agent-report           Generate prioritized improvement backlog for coding agents (JSON + markdown)
  --error-channel          Analyze error channels across project (generic errors, unhandled types, missing catchTag) — supports --format json
  --service-health         Analyze service dependency health (unsatisfied, dead services, layer inefficiencies) — supports --format json
  --performance            Detect performance anti-patterns (sequential could be parallel, unbounded concurrency, etc.) — supports --format json
  --coupling               Analyze module coupling (fan-in/fan-out; annotate intentional hubs with // effect-analyzer-known-hub or @known-hub JSDoc tag; supports --format json)
  --coupling-transitive    With --coupling: compute fan-in transitively through re-exports (consumer of barrel also counted as consumer of barrel's internal modules)
  --coupling-priority <map>  Override agent-report priority for coupling issue types (comma-separated). Example: --coupling-priority critical-fanin=P0,high-fanout=P2. Valid types: critical-fanin, high-fanin, high-fanout, accidental-hub, hub-without-annotation. Valid priorities: P0-P3.
  --improve                Apply automated fixes for fixable lint issues (use --improve-dry-run to preview)
  --improve-dry-run        Preview fixes without applying (default for --improve)
  --improve-max-fixes <n>  Limit number of fixes to apply
  --improve-rule <rule>    Only apply fixes for this rule (repeatable)
  --improve-exclude-rule <rule>  Exclude fixes for this rule (repeatable)
  --improve-min-priority <P0|P1|P2|P3>  Minimum priority level to include
  -h, --help               Show this help message

Examples:
  npx effect-analyzer                    # Analyze current directory; write colocated .md (gold tier)
  effect-analyze                           # Same
  effect-analyze ./src                     # Analyze ./src (directory -> project mode)
  effect-analyze ./program.ts              # Single file; auto-selected diagrams to stdout
  effect-analyze ./packages --coverage-audit -o coverage-baseline.json
  effect-analyze ./src --quality
  effect-analyze ./src --quality --quality-eslint ./.cache/eslint.json
  effect-analyze ./program.ts --format mermaid-paths --style-guide
  effect-analyze ./program.ts --format json --output result.json
  effect-analyze ./program.ts --colocate   # Single file + write foo.effect-analysis.md
  effect-analyze ./src --lint-source --tsgo=tsconfig.json
  effect-analyze ./src --lint-source --sarif -o findings.sarif
  effect-analyze ./src --lint-source --baseline ./.cache/effect-lint-baseline.json --fail-on-new
  effect-analyze ./src --lint-source --scorecard
  effect-analyze ./src --service-cycles --format json
  effect-analyze ./src --lint-source --bundle-output ./.artifacts/effect-lint
  effect-analyze ./workflow.ts --format mermaid-statechart   # State machine → mermaid stateDiagram-v2
  effect-analyze ./workflow.ts --format svg-statechart -o sc.html  # Self-contained XState-styled SVG
  effect-analyze ./workflow.ts --format statechart-html -o sc.html  # Local visualizer page
  effect-analyze ./workflow.ts --format xstate-config   # Emit createMachine() config for stately.ai/viz
  effect-analyze ./workflow.ts --format statechart-coverage   # Completeness report (exit 1 on warnings — CI gate)
  effect-analyze ./src --format api-docs   # Extract HttpApi structure, emit API docs markdown
  effect-analyze ./src --format openapi-paths -o paths.json  # Emit OpenAPI paths JSON
  effect-analyze ./src/types.ts --format json-schema --export User  # Exact JSON Schema, from Effect itself
  effect-analyze ./src/api.ts --format openapi-runtime --export TodoApi -o openapi.json  # Runtime OpenApi.fromApi
  effect-analyze --diff HEAD:./src/checkout.ts main:./src/checkout.ts  # Structural diff between two git refs
`;

export const printHelp = (): void => {
  process.stdout.write(HELP_TEXT + '\n');
};
