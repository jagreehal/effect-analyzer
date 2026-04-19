import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Effect } from 'effect';
import {
  analyze,
  diffPrograms,
  renderDiffMarkdown,
  renderExplanation,
  renderRailwayMermaid,
} from '../../../packages/effect-analyzer/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, '..');
const scenariosRoot = resolve(docsRoot, 'samples/review-scenarios');
const outputPath = resolve(
  docsRoot,
  'src/content/docs/case-studies/review-scenarios.mdx',
);

const SCENARIOS = [
  {
    slug: '01-add-rate-fetch',
    title: 'PR #1 — Add exchange rate fetch',
    lede: 'Two new lines. A whole new failure mode. Is there a test?',
    whatChanged:
      'The team is building up the transfer workflow. This PR adds an exchange-rate lookup after input validation.',
    textDiffTakeaway:
      'It looks like a small addition — import a dep, call it, return the extra field.',
    analyzerTakeaway:
      'The structural diff names the new step. More importantly, the workflow\'s error channel just doubled: `ValidationError` → `ValidationError | RateUnavailableError`. Every call site of this workflow is now a new potential failure surface.',
    reviewerQuestion:
      '**Is there a test for `RateUnavailableError`?** In production, rate providers have outages. A sequential retry would have been a different PR. Silently propagating is a choice — not necessarily the wrong one, but a choice the team should make deliberately.',
  },
  {
    slug: '02-parallelize',
    title: 'PR #2 — Parallelize for latency',
    lede: 'A performance refactor that changes failure semantics.',
    whatChanged:
      'Rate fetch and balance lookup were sequential. The PR parallelizes them with `Effect.all({ concurrency: "unbounded" })`.',
    textDiffTakeaway:
      'Looks like a clean refactor — two `yield*` lines collapsed into one destructured `Effect.all`.',
    analyzerTakeaway:
      'The structural diff flags `+ parallel block added`. The railway diagram restructures. When two operations run concurrently, a failure in one interrupts the other — that is not what the sequential code did. If `fetchRate` is observably slow or has side effects (telemetry, rate-limiter entries), the semantics have changed.',
    reviewerQuestion:
      '**Is either branch doing work you cannot cancel?** Parallel is not a free speed win when one operation has observable side effects and the other can fail first.',
  },
  {
    slug: '03-best-effort-confirm',
    title: 'PR #3 — Make confirmation best-effort',
    lede: 'One wrapper call. Confirmation is no longer required for success.',
    whatChanged:
      'Someone wrapped `sendConfirmation` in `Effect.orElseSucceed` so confirmation failures stop failing the workflow.',
    textDiffTakeaway:
      'The body of the generator changed slightly — a single line grew an outer call. Easy to skim past.',
    analyzerTakeaway:
      'The structural diff is unambiguous: `sendConfirmation` **moved from `generator` → `error-handler`** and a new `error-handler` block was added. The after-state railway no longer has a `ConfirmationFailedError` branch — the diagram itself tells the story.',
    reviewerQuestion:
      '**Did the PR author intend to swallow confirmation failures?** If yes: is there a dead-letter queue, reconciliation job, or alert? If no: this is a bug the reviewer just caught by reading the diagram instead of the source.',
  },
  {
    slug: '04-add-fraud-check',
    title: 'PR #4 — Add a fraud check',
    lede: 'A new service requirement quietly enters the workflow.',
    whatChanged:
      'The PR introduces a `FraudCheck` service and verifies each transfer before execution.',
    textDiffTakeaway:
      'Looks like a standard "add dependency, call it" change. The interesting detail — a new service in the R channel — is easy to miss when the `Context.Tag` class definition takes more visual space than the call.',
    analyzerTakeaway:
      'The structural diff lists both the new service yield and the new verify call as added steps. The services map for this workflow now has an extra node; anyone wiring this program up for tests or production needs to provide a `FraudCheck` implementation.',
    reviewerQuestion:
      '**What is the failure story if `FraudCheck` is down?** A hard dependency means outages cascade. A soft dependency means fraud policies have gaps. Either is a product decision, not a reviewer decision.',
  },
  {
    slug: '05-remove-retry',
    title: 'PR #5 — Clean up the retry logic',
    lede: 'A resilience regression disguised as a cleanup.',
    whatChanged:
      'Someone removed the `Effect.retry(Schedule.exponential(...))` wrapper around the whole transfer, with a commit message like "simplify workflow — provider handles retries now".',
    textDiffTakeaway:
      'The diff is a single deleted line: `.pipe(Effect.retry(...))`. This is the kind of change that passes review in 30 seconds because the reviewer reads "cleanup" and "simpler" and moves on.',
    analyzerTakeaway:
      'The structural diff flags it immediately: `- retry block removed`. All runtime tests still pass — retries only matter under transient failure, and unit tests rarely simulate the exact timing that made the retry useful. The tool catches what tests cannot.',
    reviewerQuestion:
      '**Is there actually upstream retry, or does the team assume there is?** "The provider handles it" is often aspirational. The answer determines whether this PR is a safe simplification or a resilience regression. The diff turns an implicit assumption into an explicit review question.',
  },
];

const runEffect = (effect) => Effect.runPromise(effect);

/** Shift Markdown ATX headings down by `delta` levels, capped at h6. */
const shiftHeadings = (md, delta) =>
  md.replace(/^(#{1,6})(\s)/gm, (_match, hashes, space) => {
    const next = Math.min(6, hashes.length + delta);
    return `${'#'.repeat(next)}${space}`;
  });

const textDiff = (beforePath, afterPath) => {
  const result = spawnSync(
    'diff',
    ['-u', '--label', 'before.ts', '--label', 'after.ts', beforePath, afterPath],
    { encoding: 'utf8' },
  );
  // diff exits 1 when files differ, that's expected
  return (result.stdout ?? '').trimEnd();
};

const readSource = async (filePath) => {
  const raw = await readFile(filePath, 'utf8');
  return raw.replace(/\n+$/, '');
};

const buildScenario = async (scenario) => {
  const dir = resolve(scenariosRoot, scenario.slug);
  const beforePath = resolve(dir, 'before.ts');
  const afterPath = resolve(dir, 'after.ts');

  const [beforeIRs, afterIRs] = await Promise.all([
    runEffect(analyze(beforePath).all()),
    runEffect(analyze(afterPath).all()),
  ]);

  const beforeIR = beforeIRs[0];
  const afterIR = afterIRs[0];
  if (!beforeIR || !afterIR) {
    throw new Error(
      `Scenario ${scenario.slug}: expected a program in before and after`,
    );
  }

  const diff = diffPrograms(beforeIR, afterIR);
  // Demote the renderer's headings so they nest under our page structure:
  // the page uses `## PR #N` (h2) and `### What the analyzer shows you` (h3),
  // so the diff's h1 becomes h4 and its h2s become h5s.
  const diffMd = shiftHeadings(renderDiffMarkdown(diff), 3).trimEnd();
  const beforeRailway = renderRailwayMermaid(beforeIR, {
    direction: 'LR',
  }).trimEnd();
  const afterRailway = renderRailwayMermaid(afterIR, {
    direction: 'LR',
  }).trimEnd();
  const beforeExplain = renderExplanation(beforeIR).trimEnd();
  const afterExplain = renderExplanation(afterIR).trimEnd();

  const [beforeSrc, afterSrc] = await Promise.all([
    readSource(beforePath),
    readSource(afterPath),
  ]);
  const unified = textDiff(beforePath, afterPath);

  const beforeErrors = [...beforeIR.root.errorTypes];
  const afterErrors = [...afterIR.root.errorTypes];

  return {
    ...scenario,
    beforeSrc,
    afterSrc,
    unified,
    diffMd,
    beforeRailway,
    afterRailway,
    beforeExplain,
    afterExplain,
    beforeErrors,
    afterErrors,
    beforeEffects: beforeIR.metadata.stats.totalEffects,
    afterEffects: afterIR.metadata.stats.totalEffects,
  };
};

const renderScenarioMdx = (s) => {
  const errorDelta = (() => {
    const beforeSet = new Set(s.beforeErrors);
    const added = s.afterErrors.filter((e) => !beforeSet.has(e));
    const afterSet = new Set(s.afterErrors);
    const removed = s.beforeErrors.filter((e) => !afterSet.has(e));
    const parts = [];
    if (added.length > 0) parts.push(`**+** ${added.map((e) => `\`${e}\``).join(', ')}`);
    if (removed.length > 0)
      parts.push(`**−** ${removed.map((e) => `\`${e}\``).join(', ')}`);
    return parts.length > 0
      ? parts.join(' · ')
      : '_declared error union unchanged (only the structural diff catches the behavior change)_';
  })();

  return [
    `## ${s.title}`,
    '',
    `_${s.lede}_`,
    '',
    s.whatChanged,
    '',
    '### What GitHub shows you',
    '',
    s.textDiffTakeaway,
    '',
    '```diff',
    s.unified,
    '```',
    '',
    '### What the analyzer shows you',
    '',
    s.analyzerTakeaway,
    '',
    '**Structural diff:**',
    '',
    s.diffMd,
    '',
    '**Before → After railway:**',
    '',
    '```mermaid',
    s.beforeRailway,
    '```',
    '',
    '```mermaid',
    s.afterRailway,
    '```',
    '',
    `**Declared error union:** ${errorDelta}`,
    '',
    `**Effect count:** ${String(s.beforeEffects)} → ${String(s.afterEffects)}`,
    '',
    '### The question this unlocks',
    '',
    s.reviewerQuestion,
    '',
    '<details>',
    '<summary>Raw analyzer explain (before / after)</summary>',
    '',
    '```text',
    s.beforeExplain,
    '```',
    '',
    '```text',
    s.afterExplain,
    '```',
    '',
    '</details>',
    '',
  ].join('\n');
};

const renderPage = (scenarios) => {
  const lines = [
    '---',
    'title: What a text diff misses',
    'description: Five realistic pull requests against the transfer workflow. Each looks small. Each changes the shape of the program in ways that only structural analysis surfaces.',
    'sidebar:',
    '  order: 10',
    '---',
    '',
    'import { Aside } from \'@astrojs/starlight/components\';',
    '',
    'Every section on this page is generated from real TypeScript files in `apps/docs/samples/review-scenarios` by running `effect-analyzer` against them. No hand-written output — if the analyzer changes, rerun `pnpm --dir apps/docs run generate:review-scenarios` and this page will update.',
    '',
    'The setup: the transfer team is iterating on a send-money workflow. Here are five pull requests from a single sprint. Each one has a plausible motivation. Each one hides a change that a line-by-line diff does not communicate.',
    '',
    '<Aside type="tip" title="Why this page exists">',
    'Teams do not really review lines — they review behavior. Text diff is a proxy for behavior that breaks down the moment a refactor is larger than a variable rename. Structural diff is the version that actually answers "what did this PR change about how the program runs?"',
    '</Aside>',
    '',
  ];

  for (const s of scenarios) {
    lines.push(renderScenarioMdx(s));
  }

  lines.push(
    '## What to take from this',
    '',
    'Every scenario above is a shape of PR that teams ship. None of them are contrived. The common thread is that **the source diff is a faithful record of the text change, and a lossy record of the behavior change**.',
    '',
    '- PR #1 adds a failure mode. The source diff tells you a line was added.',
    '- PR #2 changes concurrency semantics. The source diff tells you some lines were restructured.',
    '- PR #3 silences a failure. The source diff tells you an outer call was added.',
    '- PR #4 adds a dependency. The source diff tells you a new import and a new yield appeared.',
    '- PR #5 removes a resilience primitive. The source diff tells you a wrapper call was deleted.',
    '',
    'The analyzer\'s output, structural diff, error surface, railway diagram, answers a different question: _what about the behavior of this program is different now?_ That is the question every reviewer is trying to answer in their head while scrolling a diff. The tool just does it more reliably.',
    '',
    '## Related',
    '',
    '- [Semantic Diff](/effect-analyzer/project/diff/) — the feature powering every "Structural diff" block on this page.',
    '- [Transfer Observability](/effect-analyzer/diagrams/transfer-observability/) — the narrative around why the transfer example is worth analyzing at all.',
    '- [Transfer Evolution](/effect-analyzer/diagrams/transfer-evolution/) — the five-step build-up of the same workflow, showing the error channel grow step by step.',
    '',
  );

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const scenarios = [];
  for (const s of SCENARIOS) {
    // eslint-disable-next-line no-await-in-loop
    scenarios.push(await buildScenario(s));
  }
  const page = renderPage(scenarios);
  await writeFile(outputPath, page, 'utf8');
  process.stdout.write(`Wrote ${outputPath}\n`);
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
