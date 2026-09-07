---
'effect-analyzer': minor
---

Accept several paths and globs on the command line. `effect-analyze src/a.ts
src/b.ts` analyzes each file in turn, so an unquoted shell glob works, and a
quoted glob such as `'src/**/*.ts'` is expanded by the CLI itself through
`fs.glob`. A pattern that matches nothing is reported, and modes that read one
directory, follow one file, or write one output file say so rather than picking
whichever path came first.
