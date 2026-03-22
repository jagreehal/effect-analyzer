import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { DiagramQualityHintInput } from './diagram-quality';

interface EslintMessage {
  readonly ruleId?: string | null;
  readonly message?: string;
  readonly severity?: number;
}

interface EslintFileResult {
  readonly filePath?: string;
  readonly messages?: readonly EslintMessage[];
}

function isEffectLikeRule(ruleId: string | undefined | null): boolean {
  if (!ruleId) return false;
  return /effect/i.test(ruleId);
}

function mapTip(message: EslintMessage): string | undefined {
  const text = `${message.ruleId ?? ''} ${message.message ?? ''}`.toLowerCase();
  if (text.includes('yield') || text.includes('untagged')) {
    return 'Consider binding yielded values with meaningful names.';
  }
  if (text.includes('error') || text.includes('catch') || text.includes('handle')) {
    return 'If you want clearer diagrams, consider making error boundaries explicit.';
  }
  if (text.includes('service') || text.includes('layer') || text.includes('provide')) {
    return 'Consider acquiring services near the top of the workflow.';
  }
  if (text.includes('pipe') || text.includes('nested') || text.includes('lambda')) {
    return 'If you want clearer diagrams, consider extracting nested pipe lambdas into named helpers.';
  }
  return undefined;
}

function formatReason(message: EslintMessage): string | undefined {
  const rule = message.ruleId ?? 'eslint';
  const msg = (message.message ?? '').trim();
  if (!msg) return undefined;
  return `ESLint (${rule}): ${msg}`;
}

function parseResults(raw: unknown): readonly EslintFileResult[] {
  if (Array.isArray(raw)) return raw as readonly EslintFileResult[];
  if (raw && typeof raw === 'object' && 'results' in raw) {
    const results = (raw as { results?: unknown }).results;
    if (Array.isArray(results)) return results as readonly EslintFileResult[];
  }
  return [];
}

export async function loadDiagramQualityHintsFromEslintJson(
  jsonPath: string,
): Promise<Map<string, DiagramQualityHintInput>> {
  const content = await readFile(jsonPath, 'utf-8');
  const parsed = JSON.parse(content) as unknown;
  const results = parseResults(parsed);
  const byFile = new Map<string, { reasons: string[]; tips: string[] }>();

  for (const file of results) {
    const filePath = file.filePath ? resolve(file.filePath) : undefined;
    if (!filePath) continue;
    const messages = file.messages ?? [];
    for (const message of messages) {
      if (!isEffectLikeRule(message.ruleId)) continue;
      const cur = byFile.get(filePath) ?? { reasons: [], tips: [] };
      const reason = formatReason(message);
      if (reason) cur.reasons.push(reason);
      const tip = mapTip(message);
      if (tip) cur.tips.push(tip);
      byFile.set(filePath, cur);
    }
  }

  const out = new Map<string, DiagramQualityHintInput>();
  for (const [filePath, hints] of byFile) {
    out.set(filePath, {
      reasons: [...new Set(hints.reasons)].slice(0, 8),
      tips: [...new Set(hints.tips)].slice(0, 5),
    });
  }
  return out;
}

