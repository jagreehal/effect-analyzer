---
'effect-analyzer': minor
---

Sharpen the CLI's output and directory walk. Progress, counts and warnings now
go to stderr, so `--format mermaid > diagram.mmd` writes a file that parses
while the status stays visible in the terminal. A run over several paths with
`--format json` prints one array, so `| jq` reads the whole run. `--extensions`
and `--max-depth` expose the directory walk's discovery rules, which until now
were fixed at `.ts`/`.tsx` and ten levels.
