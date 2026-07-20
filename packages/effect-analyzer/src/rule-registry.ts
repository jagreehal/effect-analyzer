import { DEFAULT_LINT_RULES } from './effect-linter';
import type { StrictRule } from './strict-diagnostics';

export type RuleDomain = 'source' | 'effect-lint' | 'strict';
export type RuleSeverity = 'error' | 'warning' | 'info';
export type RuleConfidence = 'high' | 'medium' | 'low';
export type RuleProfile = 'strict' | 'ci' | 'migration' | 'docs';

export interface RuleDoc {
  readonly code: string;
  readonly domain: RuleDomain;
  readonly severity: RuleSeverity;
  readonly confidence: RuleConfidence;
  readonly title: string;
  readonly description: string;
  readonly example?: string | undefined;
  readonly docUrl?: string | undefined;
}

export interface RuleSearchResult {
  readonly doc: RuleDoc;
  readonly score: number;
}

const RULE_DOC_BASE = 'https://effect.website/docs';

const normalizeDisplayText = (text: string): string =>
  text
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const withDocUrl = (domain: RuleDomain, code: string): string =>
  `${RULE_DOC_BASE}/tooling/effect-analyzer/rules/${domain}/${code}`;

const SOURCE_RULE_DOCS_BASE = [
  { code: 'detached-fiber-in-test', domain: 'source', severity: 'warning', title: 'Detached Fiber In Test', description: 'Flags runFork-style APIs in tests that can outlive test scope and cause flakiness.', example: 'Effect.runFork(Effect.never)' },
  { code: 'effect-fail-untagged', domain: 'source', severity: 'warning', title: 'Effect.fail With Untagged Error', description: 'Flags Effect.fail/failSync with built-in Error instances that degrade typed error channels.', example: 'Effect.fail(new Error("boom"))' },
  { code: 'empty-effect-all', domain: 'source', severity: 'info', title: 'Empty Effect.all', description: 'Flags Effect.all on empty arrays/objects, which is often dead or placeholder code.', example: 'Effect.all([])' },
  { code: 'forEach-without-concurrency', domain: 'source', severity: 'info', title: 'forEach Without Explicit Concurrency', description: 'Encourages explicit concurrency options for Effect.forEach and Stream.runForEach.', example: 'Effect.forEach(items, f)' },
  { code: 'identity-catch', domain: 'source', severity: 'warning', title: 'Identity Catch Handler', description: 'Flags catch handlers that only re-fail the same value and add no semantic value.', example: 'Effect.catch(eff, (e) => Effect.fail(e))' },
  { code: 'live-layer-in-test', domain: 'source', severity: 'warning', title: 'Live Layer In Test', description: 'Flags Live layer references in test files where deterministic test layers are expected.', example: 'const layer = UserRepoLive' },
  { code: 'mutable-in-concurrent', domain: 'source', severity: 'warning', title: 'Mutable State In Concurrent Effect', description: 'Flags let/var mutation inside parallel/fork/race contexts.', example: 'let n = 0; yield* Effect.all([Effect.sync(() => n++)])' },
  { code: 'nondeterministic-test-api', domain: 'source', severity: 'warning', title: 'Nondeterministic Test API', description: 'Flags direct Date.now/new Date/Math.random usage in test code.', example: 'const now = Date.now()' },
  { code: 'promise-api-in-gen', domain: 'source', severity: 'warning', title: 'Promise API In Effect.gen', description: 'Flags Promise static API usage inside Effect.gen where Effect combinators should be used.', example: 'Promise.all(tasks)' },
  { code: 'raw-side-effect-in-gen', domain: 'source', severity: 'warning', title: 'Raw Side Effect In Effect.gen', description: 'Flags non-Effect side effects in generator bodies (fetch, process.env, setTimeout, new Promise, etc.).', example: 'const r = fetch("/x")' },
  { code: 'run-effect-in-gen', domain: 'source', severity: 'warning', title: 'run* API Inside Effect.gen', description: 'Flags Effect.run* calls inside Effect.gen where composition via yield* is preferred.', example: 'Effect.runPromise(effect)' },
  { code: 'runPromise-then-chain', domain: 'source', severity: 'info', title: 'Promise Chain After runPromise', description: 'Flags .then/.catch/.finally chains after Effect.runPromise/runPromiseExit.', example: 'Effect.runPromise(eff).then(...)' },
  { code: 'runSync-on-async', domain: 'source', severity: 'error', title: 'runSync On Async Effect', description: 'Flags Effect.runSync on async-tainted effects that will throw at runtime.', example: 'Effect.runSync(Effect.tryPromise(...))' },
  { code: 'runSyncExit-on-async', domain: 'source', severity: 'error', title: 'runSyncExit On Async Effect', description: 'Flags Effect.runSyncExit on async-tainted effects that will throw at runtime.', example: 'Effect.runSyncExit(Effect.tryPromise(...))' },
  { code: 'schedule-unbounded', domain: 'source', severity: 'warning', title: 'Potentially Unbounded Schedule', description: 'Flags repeating schedule constructions without visible bounds.', example: 'Schedule.forever' },
  { code: 'sleep-without-testclock', domain: 'source', severity: 'info', title: 'Effect.sleep Without TestClock In Tests', description: 'Flags real-time sleep usage in test files when TestClock is not used.', example: 'Effect.sleep(Duration.seconds(1))' },
  { code: 'unsafe-api-usage', domain: 'source', severity: 'warning', title: 'Unsafe API Usage', description: 'Flags direct Effect/Runtime unsafe APIs that bypass typed runtime safety boundaries.', example: 'Effect.unsafeMakeSemaphore(1)' },
  { code: 'untagged-throw', domain: 'source', severity: 'warning', title: 'Untagged Throw In Effect Context', description: 'Flags throw new Error/TypeError/RangeError inside Effect contexts.', example: 'throw new Error("boom")' },
  ] as const satisfies readonly Omit<RuleDoc, 'docUrl' | 'confidence'>[];

const SOURCE_RULE_DOCS: readonly RuleDoc[] = SOURCE_RULE_DOCS_BASE.map((x) => ({
  ...x,
  confidence: x.severity === 'error' ? 'high' : x.severity === 'warning' ? 'medium' : 'low',
  docUrl: withDocUrl('source', x.code),
}));

const STRICT_RULE_DOCS_BY_RULE: Record<StrictRule, Omit<RuleDoc, 'code' | 'domain' | 'docUrl'>> = {
  'missing-error-type': { severity: 'warning', confidence: 'medium', title: 'Missing Error Type', description: 'Effect node should expose an explicit typed error channel.' },
  'unknown-error-type': { severity: 'warning', confidence: 'medium', title: 'Unknown Error Type', description: 'Effect node error type is unknown and should be narrowed.' },
  'parallel-missing-errors': { severity: 'warning', confidence: 'medium', title: 'Parallel Branch Missing Errors', description: 'Parallel branch effect lacks explicit error type information.' },
  'race-missing-errors': { severity: 'warning', confidence: 'medium', title: 'Race Branch Missing Errors', description: 'Race branch effect lacks explicit error type information.' },
  'effect-without-handler': { severity: 'warning', confidence: 'medium', title: 'Effect Without Handler', description: 'Effect can fail on this path but no nearby handler is detected.' },
  'fiber-potential-leak': { severity: 'warning', confidence: 'medium', title: 'Potential Fiber Leak', description: 'Fork-like operation appears without join/interrupt/await in scope.' },
  'resource-missing-scope': { severity: 'warning', confidence: 'medium', title: 'Resource Missing Scope', description: 'Resource acquisition appears without visible Effect.scoped boundary.' },
  'unbounded-concurrency': { severity: 'warning', confidence: 'medium', title: 'Unbounded Concurrency', description: 'Large parallel/loop operations should set explicit concurrency bounds.' },
  'unused-service': { severity: 'warning', confidence: 'medium', title: 'Unused Service', description: 'Provided service appears unused in analyzed graph.' },
  'dead-code-path': { severity: 'warning', confidence: 'medium', title: 'Dead Code Path', description: 'Decision condition resolves to a constant branch outcome.' },
};

const STRICT_RULE_DOCS: readonly RuleDoc[] = (Object.keys(STRICT_RULE_DOCS_BY_RULE) as StrictRule[]).map((rule) => ({
  code: rule,
  domain: 'strict',
  docUrl: withDocUrl('strict', rule),
  ...STRICT_RULE_DOCS_BY_RULE[rule],
}));

const EFFECT_LINT_RULE_DOCS: readonly RuleDoc[] = DEFAULT_LINT_RULES.map((rule) => ({
  code: rule.name,
  domain: 'effect-lint',
  severity: rule.severity,
  confidence: rule.severity === 'error' ? 'high' : 'medium',
  title: rule.name,
  description: rule.description,
  docUrl: withDocUrl('effect-lint', rule.name),
}));

const severityRank = (severity: RuleSeverity): number => (severity === 'error' ? 0 : severity === 'warning' ? 1 : 2);

const normalizeRuleDoc = (doc: RuleDoc): RuleDoc => ({
  ...doc,
  code: normalizeDisplayText(doc.code),
  title: normalizeDisplayText(doc.title),
  description: normalizeDisplayText(doc.description),
  example: doc.example ? normalizeDisplayText(doc.example) : undefined,
  docUrl: doc.docUrl ? normalizeDisplayText(doc.docUrl) : undefined,
});

let cachedAllDocs: readonly RuleDoc[] | undefined;
const searchCache = new Map<string, readonly RuleSearchResult[]>();
const explainCache = new Map<string, RuleDoc | undefined>();

export const listAllRuleDocs = (): readonly RuleDoc[] => {
  if (cachedAllDocs) return cachedAllDocs;
  const merged = [...SOURCE_RULE_DOCS, ...EFFECT_LINT_RULE_DOCS, ...STRICT_RULE_DOCS].map(normalizeRuleDoc);
  const canonical = merged.sort((a, b) => {
    if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
    const sevCmp = severityRank(a.severity) - severityRank(b.severity);
    if (sevCmp !== 0) return sevCmp;
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    if (a.description !== b.description) return a.description.localeCompare(b.description);
    return (a.example ?? '').localeCompare(b.example ?? '');
  });
  const seen = new Set<string>();
  const deduped: RuleDoc[] = [];
  for (const doc of canonical) {
    const key = [doc.domain, doc.code, doc.severity, doc.confidence, doc.title, doc.description, doc.example ?? '', doc.docUrl ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(doc);
  }
  cachedAllDocs = deduped;
  return deduped;
};

export const findRuleDoc = (code: string, domain?: RuleDomain): RuleDoc | undefined => {
  const normalizedCode = normalizeDisplayText(code);
  const key = `${domain ?? 'any'}|${normalizedCode}`;
  if (explainCache.has(key)) return explainCache.get(key);
  const docs = listAllRuleDocs();
  const found = domain !== undefined ? docs.find((d) => d.domain === domain && d.code === normalizedCode) : docs.find((d) => d.code === normalizedCode);
  explainCache.set(key, found);
  return found;
};

export const getRuleCodesForProfile = (profile: RuleProfile): readonly string[] => {
  const docs = listAllRuleDocs();
  const select = (d: RuleDoc): boolean => {
    if (profile === 'strict') return d.domain === 'strict' || d.severity === 'error';
    if (profile === 'ci') return d.severity !== 'info';
    if (profile === 'migration') {
      const migrationTags = ['promise', 'runSync', 'layer', 'catch', 'untagged', 'schedule', 'concurrency'];
      const hay = `${d.code} ${d.title} ${d.description}`.toLowerCase();
      return migrationTags.some((t) => hay.includes(t));
    }
    return d.domain === 'source' || d.domain === 'effect-lint';
  };
  return docs.filter(select).map((d) => d.code);
};

export const searchRuleDocs = (query: string, domain?: RuleDomain): readonly RuleSearchResult[] => {
  const q = normalizeDisplayText(query).toLowerCase();
  const key = `${domain ?? 'any'}|${q}`;
  const cached = searchCache.get(key);
  if (cached) return cached;
  if (q.length === 0) {
    const all = listAllRuleDocs().filter((d) => (domain ? d.domain === domain : true)).map((doc) => ({ doc, score: 0 }));
    searchCache.set(key, all);
    return all;
  }
  const docs = listAllRuleDocs().filter((d) => (domain ? d.domain === domain : true));
  const scored = docs
    .map((doc): RuleSearchResult => {
      const code = doc.code.toLowerCase();
      const title = doc.title.toLowerCase();
      const desc = doc.description.toLowerCase();
      const example = (doc.example ?? '').toLowerCase();
      let score = 0;
      if (code === q) score += 100;
      if (code.includes(q)) score += 50;
      if (title.includes(q)) score += 35;
      if (desc.includes(q)) score += 20;
      if (example.includes(q)) score += 10;
      return { doc, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.doc.domain !== b.doc.domain) return a.doc.domain.localeCompare(b.doc.domain);
      const sevCmp = severityRank(a.doc.severity) - severityRank(b.doc.severity);
      if (sevCmp !== 0) return sevCmp;
      return a.doc.code.localeCompare(b.doc.code);
    });
  searchCache.set(key, scored);
  return scored;
};

export const renderRuleDocsText = (): string => {
  const docs = listAllRuleDocs();
  const lines: string[] = [];
  lines.push('# effect-analyzer rules');
  lines.push('');
  let currentDomain: RuleDomain | undefined;
  for (const doc of docs) {
    if (doc.domain !== currentDomain) {
      currentDomain = doc.domain;
      lines.push(`## ${currentDomain}`);
      lines.push('');
    }
    lines.push(`- [${doc.severity}/${doc.confidence}] ${doc.code}: ${doc.description}`);
    if (doc.example) lines.push(`  example: ${doc.example}`);
    if (doc.docUrl) lines.push(`  docs: ${doc.docUrl}`);
  }
  lines.push('');
  lines.push(`Total rules: ${docs.length}`);
  return lines.join('\n');
};

export const renderRuleDocsJson = (pretty = true): string => JSON.stringify(listAllRuleDocs(), null, pretty ? 2 : 0);

export interface RuleIndexEntry {
  readonly id: string;
  readonly code: string;
  readonly domain: RuleDomain;
  readonly severity: RuleSeverity;
  readonly confidence: RuleConfidence;
  readonly title: string;
  readonly snippet: string;
}

export const buildRuleIndex = (): readonly RuleIndexEntry[] =>
  listAllRuleDocs().map((doc) => ({
    id: `${doc.domain}:${doc.code}`,
    code: doc.code,
    domain: doc.domain,
    severity: doc.severity,
    confidence: doc.confidence,
    title: doc.title,
    snippet: normalizeDisplayText(`${doc.description}${doc.example ? ` Example: ${doc.example}` : ''}`),
  }));

export const renderRuleIndexJson = (pretty = true): string => JSON.stringify(buildRuleIndex(), null, pretty ? 2 : 0);

export const explainRule = (code: string, domain?: RuleDomain): RuleDoc | undefined => findRuleDoc(code, domain);
