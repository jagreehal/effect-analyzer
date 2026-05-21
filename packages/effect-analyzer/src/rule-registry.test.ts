import { describe, expect, it } from 'vitest';
import {
  buildRuleIndex,
  explainRule,
  findRuleDoc,
  getRuleCodesForProfile,
  listAllRuleDocs,
  renderRuleDocsJson,
  renderRuleDocsText,
  searchRuleDocs,
} from './rule-registry';

describe('rule-registry', () => {
  it('returns deterministic, deduped docs ordered by domain/severity/code', () => {
    const docs = listAllRuleDocs();
    expect(docs.length).toBeGreaterThan(0);
    const keys = docs.map((d) =>
      [d.domain, d.severity, d.code, d.title, d.description, d.example ?? ''].join('|'),
    );
    expect(new Set(keys).size).toBe(keys.length);

    const severityRank = (s: string): number => (s === 'error' ? 0 : s === 'warning' ? 1 : 2);
    for (let i = 1; i < docs.length; i++) {
      const prev = docs[i - 1]!;
      const cur = docs[i]!;
      if (prev.domain !== cur.domain) {
        expect(prev.domain.localeCompare(cur.domain)).toBeLessThanOrEqual(0);
        continue;
      }
      const sevCmp = severityRank(prev.severity) - severityRank(cur.severity);
      if (sevCmp !== 0) {
        expect(sevCmp).toBeLessThanOrEqual(0);
        continue;
      }
      expect(prev.code.localeCompare(cur.code)).toBeLessThanOrEqual(0);
    }
  });

  it('includes key deterministic source and strict rules', () => {
    const docs = listAllRuleDocs();
    const codes = new Set(docs.map((d) => `${d.domain}:${d.code}`));
    expect(codes.has('source:runSync-on-async')).toBe(true);
    expect(codes.has('source:raw-side-effect-in-gen')).toBe(true);
    expect(codes.has('strict:dead-code-path')).toBe(true);
    expect(codes.has('strict:unbounded-concurrency')).toBe(true);
  });

  it('renders stable markdown-like text with total count footer', () => {
    const text = renderRuleDocsText();
    expect(text).toContain('# effect-analyzer rules');
    expect(text).toContain('## source');
    expect(text).toContain('## strict');
    expect(text).toMatch(/Total rules: \d+/);
  });

  it('supports deterministic rule lookup by code and domain', () => {
    const source = findRuleDoc('runSync-on-async', 'source');
    expect(source?.domain).toBe('source');
    expect(source?.severity).toBe('error');

    const strict = findRuleDoc('dead-code-path', 'strict');
    expect(strict?.domain).toBe('strict');

    const missing = findRuleDoc('does-not-exist');
    expect(missing).toBeUndefined();
  });

  it('renders deterministic JSON array output', () => {
    const json = renderRuleDocsJson(true);
    const parsed = JSON.parse(json) as { domain: string; severity: string; code: string }[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    const first = parsed[0]!;
    expect(typeof first.domain).toBe('string');
    expect(typeof first.severity).toBe('string');
    expect(typeof first.code).toBe('string');

    const compact = renderRuleDocsJson(false);
    const compactParsed = JSON.parse(compact);
    expect(compactParsed).toEqual(parsed);
  });

  it('builds deterministic rule index entries', () => {
    const index = buildRuleIndex();
    expect(index.length).toBeGreaterThan(0);
    expect(index[0]?.id).toContain(':');
    expect(index[0]?.snippet.length).toBeGreaterThan(0);
  });

  it('searches rules with deterministic ranked order', () => {
    const results = searchRuleDocs('runsync');
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect((results[i - 1]?.score ?? 0) >= (results[i]?.score ?? 0)).toBe(true);
    }
  });

  it('supports explainRule helper', () => {
    const explained = explainRule('runSync-on-async', 'source');
    expect(explained?.code).toBe('runSync-on-async');
    expect(explained?.docUrl).toContain('/rules/source/runSync-on-async');
  });

  it('provides stable profile rule code sets', () => {
    const strict = getRuleCodesForProfile('strict');
    const ci = getRuleCodesForProfile('ci');
    const migration = getRuleCodesForProfile('migration');
    const docs = getRuleCodesForProfile('docs');
    expect(strict.length).toBeGreaterThan(0);
    expect(ci.length).toBeGreaterThan(0);
    expect(migration.length).toBeGreaterThan(0);
    expect(docs.length).toBeGreaterThan(0);
  });
});
