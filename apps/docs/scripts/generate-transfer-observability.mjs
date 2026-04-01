import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import {
  analyze,
  renderExplanation,
  renderRailwayMermaid,
  renderStaticMermaid,
} from '../../../packages/effect-analyzer/dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, '..');
const sampleDir = resolve(docsRoot, 'samples/observability-transfer');
const evolutionDir = resolve(sampleDir, 'evolution');
const rawDir = resolve(evolutionDir, 'raw');
const generatedEvolutionDocPath = resolve(
  docsRoot,
  'src/content/docs/case-studies/transfer-evolution.mdx',
);

const TOP_LEVEL_SAMPLE_FILES = [
  'convert-currency.ts',
  'execute-transfer.ts',
  'external-client.ts',
  'fetch-rate.ts',
  'send-confirmation.ts',
  'send-money-workflow.ts',
  'types.ts',
  'validate-transfer.ts',
];

const EVOLUTION_STEPS = [
  {
    file: 'step-1-validate.ts',
    title: 'Step 1: Validate input',
    desc: 'One operation. One possible failure. The type system already knows what can go wrong.',
  },
  {
    file: 'step-2-fetch-rate.ts',
    title: 'Step 2: + Fetch exchange rate',
    desc: 'A second step, a second way to fail. The error channel grows automatically.',
  },
  {
    file: 'step-3-convert.ts',
    title: 'Step 3: + Check balance & convert',
    desc: "Balance check introduces a new failure mode. The compiler tracks it, you don't have to.",
  },
  {
    file: 'step-4-execute.ts',
    title: 'Step 4: + Execute transfer',
    desc: 'The money moves. Two new failure modes from the external provider. Still zero runtime needed to see them.',
  },
  {
    file: 'step-5-confirm.ts',
    title: 'Step 5: + Send confirmation (complete)',
    desc: 'The complete workflow. Six effects, six error channels, zero ambiguity. Every path is visible before a single line runs.',
  },
];

const runEffect = async (effect) => Effect.runPromise(effect);

const formatStatsJson = (programName, stats) =>
  `${JSON.stringify([{ program: programName, stats }], null, 2)}\n`;

const renderProgramSection = async (filePath) => {
  const programs = await runEffect(analyze(filePath).all());
  const fileName = basename(filePath);

  if (programs.length === 0) {
    return [
      `# Effect Analysis: ${fileName}`,
      '',
      'No analyzable Effect programs were found in this file.',
      '',
    ].join('\n');
  }

  const sections = [`# Effect Analysis: ${fileName}`, ''];

  for (const [index, program] of programs.entries()) {
    if (programs.length > 1) {
      sections.push(`## Program ${index + 1}: ${program.root.programName}`, '');
    }

    sections.push('## Metadata', '');
    sections.push(`- **File**: \`${filePath}\``);
    sections.push(
      `- **Analyzed**: ${new Date(program.metadata.analyzedAt).toISOString()}`,
    );
    sections.push(`- **Source Type**: ${program.root.source}`);
    sections.push('');

    sections.push('## Effect Flow', '', '```mermaid');
    sections.push(renderStaticMermaid(program));
    sections.push('```', '');

    sections.push('## Statistics', '');
    sections.push(
      `- **Total Effects**: ${program.metadata.stats.totalEffects}`,
    );
    sections.push('');

    sections.push('## Explanation', '', '```');
    sections.push(renderExplanation(program));
    sections.push('```', '');

    if (program.root.errorTypes.length > 0) {
      sections.push('## Error Types', '');
      for (const errorType of program.root.errorTypes) {
        sections.push(`- \`${errorType}\``);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
};

const escapeHtml = (source) =>
  source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const stepSection = (step, index) => {
  const delay = (index * 0.1 + 0.1).toFixed(1);
  const errorTags = step.errorPaths
    .map(
      (errorPath, errorIndex) =>
        `<span class="err-tag inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-err/8 text-err border border-err/15" style="animation-delay:${(errorIndex * 0.1).toFixed(1)}s">${escapeHtml(errorPath)}</span>`,
    )
    .join('\n          ');

  return `
    <section id="step-${index + 1}" class="step-card mb-20 md:mb-28" style="animation-delay: ${delay}s">
      <div class="flex items-start gap-6 mb-8">
        <div class="flex-shrink-0 flex flex-col items-center">
          <div class="timeline-dot w-10 h-10 rounded-full bg-accent text-paper flex items-center justify-center font-display text-xl font-bold">${index + 1}</div>
        </div>
        <div>
          <h2 class="font-display text-3xl md:text-4xl">${escapeHtml(step.title.replace(/^Step \\d+: /, ''))}</h2>
          <p class="text-muted mt-2 max-w-lg">${escapeHtml(step.desc)}</p>
        </div>
      </div>
      <div class="ml-0 md:ml-16">
        <div class="bg-white border border-ink/8 rounded-lg p-6 md:p-10 shadow-sm">
          <div class="mermaid-wrap">
            <pre class="mermaid">
${step.railway}
            </pre>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          ${errorTags}
        </div>
        <div class="mt-3 flex gap-6 text-xs font-mono text-muted">
          <span class="stat-num"><strong class="text-ink">${step.totalEffects}</strong> effect${step.totalEffects === 1 ? '' : 's'}</span>
          <span class="stat-num"><strong class="text-ink">${step.errorPaths.length}</strong> error path${step.errorPaths.length === 1 ? '' : 's'}</span>
        </div>
        <details class="mt-4">
          <summary class="text-xs font-mono text-muted cursor-pointer hover:text-ink transition-colors">raw effect-analyze output</summary>
          <pre class="mt-2 p-4 bg-ink text-paper/80 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed">${escapeHtml(step.explain)}</pre>
        </details>
      </div>
    </section>`;
};

const renderEvolutionMarkdown = (steps) => {
  const lines = [
    '# Send Money Workflow: Railway Diagram Evolution',
    '',
    'Each step adds one more operation to the pipeline.',
    'The railway diagram shows the happy path (ok) and every error branch.',
    '',
    'Generated by the local `effect-analyzer` source in this repository. Static analysis only, no code executed.',
    '',
  ];

  for (const step of steps) {
    lines.push(`## ${step.title}`, '', '```mermaid');
    lines.push(step.railway);
    lines.push('```', '', '<details><summary>Analysis</summary>', '', '```');
    lines.push(step.explain);
    lines.push('```', '', '```json');
    lines.push(step.stats.trimEnd());
    lines.push('```', '', '</details>', '');
  }

  return `${lines.join('\n')}\n`;
};

const renderEvolutionDocPage = (steps) => {
  const lines = [
    '---',
    'title: Transfer Evolution',
    'description: A generated step-by-step walkthrough of the send-money workflow, rendered directly in the docs from local analyzer output.',
    'sidebar:',
    '  order: 5',
    '---',
    '',
    'This page is generated from the local transfer fixture and the current `effect-analyzer` implementation.',
    '',
    'Every Mermaid block below comes from static analysis of the TypeScript source in `apps/docs/samples/observability-transfer/evolution`.',
    '',
    'No code is executed. If the analyzer changes, rerun `pnpm --dir apps/docs run generate:transfer-observability` and this page will update.',
    '',
  ];

  for (const step of steps) {
    lines.push(`## ${step.title}`, '', step.desc, '', '```mermaid');
    lines.push(step.railway);
    lines.push('```', '');
    lines.push(`- **Effects**: ${step.totalEffects}`);
    lines.push(`- **Error paths**: ${step.errorPaths.join(', ') || 'none'}`);
    lines.push('', '### Raw effect-analyze output', '', '```');
    lines.push(step.explain);
    lines.push('```', '', '```json');
    lines.push(step.stats.trimEnd());
    lines.push('```', '');
  }

  lines.push(
    '## Related',
    '',
    '- [Transfer Observability](/effect-analyzer/case-studies/transfer-observability/) for the narrative around implementation, review, testing, and communication.',
    '',
  );

  return `${lines.join('\n')}\n`;
};

const removeGeneratedTopLevelAnalyses = async () => {
  const entries = await readdir(sampleDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.effect-analysis.md'),
      )
      .map((entry) => rm(join(sampleDir, entry.name), { force: true })),
  );
};

const generateTopLevelAnalyses = async () => {
  await removeGeneratedTopLevelAnalyses();

  for (const fileName of TOP_LEVEL_SAMPLE_FILES) {
    const filePath = join(sampleDir, fileName);
    const outputPath = join(
      sampleDir,
      `${fileName.slice(0, fileName.length - extname(fileName).length)}.effect-analysis.md`,
    );
    const markdown = await renderProgramSection(filePath);
    await writeFile(outputPath, markdown, 'utf8');
  }
};

const analyzeEvolutionStep = async (step) => {
  const filePath = join(evolutionDir, step.file);
  const program = await runEffect(analyze(filePath).first());
  return {
    title: step.title,
    desc: step.desc,
    railway: renderRailwayMermaid(program),
    explain: renderExplanation(program),
    stats: formatStatsJson(program.root.programName, program.metadata.stats),
    errorPaths: program.root.errorTypes,
    totalEffects: program.metadata.stats.totalEffects,
  };
};

const generateEvolutionArtifacts = async () => {
  await mkdir(rawDir, { recursive: true });
  const steps = await Promise.all(EVOLUTION_STEPS.map(analyzeEvolutionStep));

  for (const [index, step] of steps.entries()) {
    const prefix = `step-${index + 1}`;
    await writeFile(
      join(rawDir, `${prefix}-railway.mmd`),
      `${step.railway}\n`,
      'utf8',
    );
    await writeFile(
      join(rawDir, `${prefix}-explain.txt`),
      `${step.explain}\n`,
      'utf8',
    );
    await writeFile(join(rawDir, `${prefix}-stats.json`), step.stats, 'utf8');
  }

  await writeFile(
    join(evolutionDir, 'RAILWAY-EVOLUTION.md'),
    renderEvolutionMarkdown(steps),
    'utf8',
  );
  await writeFile(
    generatedEvolutionDocPath,
    renderEvolutionDocPage(steps),
    'utf8',
  );
};

const main = async () => {
  await generateTopLevelAnalyses();
  await rm(resolve(docsRoot, 'public/demos/transfer-evolution'), {
    recursive: true,
    force: true,
  });
  await rm(resolve(docsRoot, 'public/demos/transfer-observability-analysis.html'), {
    force: true,
  });
  await rm(resolve(docsRoot, 'public/demos/transfer-analysis.html'), {
    force: true,
  });
  await generateEvolutionArtifacts();

  const outputs = [
    relative(docsRoot, sampleDir),
    relative(docsRoot, generatedEvolutionDocPath),
  ];
  console.log(
    `Generated transfer observability artifacts:\n- ${outputs.join('\n- ')}`,
  );
};

await main();
