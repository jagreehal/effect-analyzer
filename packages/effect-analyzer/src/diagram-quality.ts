import { Option } from 'effect';
import type {
  StaticEffectIR,
  StaticFlowNode,
  StaticEffectNode,
  DiagramQuality,
  DiagramQualityMetrics,
  DiagramQualityWithFile,
  DiagramTopOffendersReport,
  DiagramTopOffenderEntry,
} from './types';
import { getStaticChildren } from './types';
import { generatePaths } from './path-generator';
import { summarizePathSteps } from './output/mermaid';

export interface DiagramQualityHintInput {
  readonly reasons?: readonly string[] | undefined;
  readonly tips?: readonly string[] | undefined;
}

export interface DiagramQualityOptions {
  readonly styleGuideSummary?: boolean | undefined;
  readonly hints?: DiagramQualityHintInput | undefined;
}

const MAX_PROGRAM_TIPS = 3;
const MAX_FILE_TIPS = 5;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function uniqueCapped(items: readonly string[], max: number): string[] {
  return [...new Set(items)].slice(0, max);
}

function startsWithAllowedTipPrefix(tip: string): boolean {
  return (
    tip.startsWith('Consider') ||
    tip.startsWith('If you want clearer diagrams') ||
    tip.startsWith('For larger programs')
  );
}

function normalizeTip(tip: string): string {
  if (startsWithAllowedTipPrefix(tip)) return tip;
  return `Consider ${tip.charAt(0).toLowerCase()}${tip.slice(1)}`;
}

function collectAllNodes(nodes: readonly StaticFlowNode[]): StaticFlowNode[] {
  const out: StaticFlowNode[] = [];
  const visit = (list: readonly StaticFlowNode[]) => {
    for (const node of list) {
      out.push(node);
      const children = Option.getOrElse(getStaticChildren(node), () => [] as readonly StaticFlowNode[]);
      if (children.length > 0) visit(children);
    }
  };
  visit(nodes);
  return out;
}

function isLogLike(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('log') || n.includes('logger') || n.includes('taperror');
}

function looksAnonymousEffectNode(node: StaticEffectNode): boolean {
  const callee = node.callee.trim();
  if (callee === '' || callee === '_' || callee === 'Effect') return true;
  if (/call expression/i.test(callee)) return true;
  if (/^program-\d+$/i.test(node.name ?? '')) return true;
  return false;
}

function isServiceCallNode(node: StaticFlowNode): node is StaticEffectNode {
  return (
    node.type === 'effect' &&
    (node.semanticRole === 'service-call' ||
      node.serviceCall !== undefined ||
      node.serviceMethod !== undefined)
  );
}

function hasNamedServiceCallee(node: StaticEffectNode): boolean {
  const c = node.callee.trim();
  if (c === '' || c === '_' || c === 'Effect') return false;
  if (/unknown/i.test(c) || /call expression/i.test(c)) return false;
  return true;
}

function computeMetrics(
  ir: StaticEffectIR,
  options: DiagramQualityOptions = {},
): DiagramQualityMetrics {
  const nodes = collectAllNodes(ir.root.children);
  const detailedSteps = nodes.length;
  const effects = nodes.filter((n): n is StaticEffectNode => n.type === 'effect');

  const sideEffects = effects.filter((n) => n.semanticRole === 'side-effect');
  const logEffects = effects.filter((n) => isLogLike(n.displayName ?? n.name ?? n.callee));
  const unknownNodes = nodes.filter((n) => n.type === 'unknown').length;

  const anonymousNodeCount = nodes.filter((n) => {
    if (n.type === 'unknown') return true;
    if (n.type === 'pipe') return true;
    if (n.type === 'effect') return looksAnonymousEffectNode(n);
    return false;
  }).length;

  const serviceCalls = nodes.filter((n) => isServiceCallNode(n));
  const namedServiceCalls = serviceCalls.filter((n) => hasNamedServiceCallee(n));

  const pipeNodes = nodes.filter((n): n is StaticFlowNode & { type: 'pipe'; transformations: readonly StaticFlowNode[] } => n.type === 'pipe');
  const pipeChainCount = pipeNodes.length;
  const maxPipeChainLength = pipeNodes.length > 0
    ? Math.max(...pipeNodes.map((p) => 1 + p.transformations.length))
    : 0;

  const paths = generatePaths(ir);
  const representativePath = [...paths].sort((a, b) => b.steps.length - a.steps.length)[0];
  const summary = representativePath
    ? summarizePathSteps(representativePath, {
        collapseRepeatedLogs: true,
        collapsePureTransforms: true,
        styleGuide: options.styleGuideSummary ?? false,
      })
    : { steps: [] as const, collapsedGroups: 0 };

  const ratioBase = detailedSteps > 0 ? detailedSteps : 1;
  const serviceBase = serviceCalls.length > 0 ? serviceCalls.length : 1;

  return {
    stepCountDetailed: detailedSteps,
    stepCountSummary: summary.steps.length,
    collapsedGroupsSummary: summary.collapsedGroups,
    logRatio: logEffects.length / ratioBase,
    sideEffectRatio: sideEffects.length / ratioBase,
    anonymousNodeCount,
    anonymousRatio: anonymousNodeCount / ratioBase,
    unknownNodeCount: unknownNodes,
    serviceCallCount: serviceCalls.length,
    namedServiceCallRatio: namedServiceCalls.length / serviceBase,
    pipeChainCount,
    maxPipeChainLength,
  };
}

function scoreFromMetrics(metrics: DiagramQualityMetrics): { score: number; band: DiagramQuality['band'] } {
  const unknownPenalty = Math.min(35, metrics.unknownNodeCount * 8);
  const anonymousPenalty = Math.min(25, Math.round(metrics.anonymousRatio * 40));
  const stepPenalty =
    metrics.stepCountDetailed > 24
      ? Math.min(22, Math.round((metrics.stepCountDetailed - 24) * 0.6))
      : 0;
  const logPenalty = Math.min(12, Math.round(metrics.logRatio * 30));
  const sideEffectPenalty =
    metrics.sideEffectRatio > 0.75
      ? Math.min(8, Math.round((metrics.sideEffectRatio - 0.75) * 40))
      : 0;

  const score = clamp(
    Math.round(100 - unknownPenalty - anonymousPenalty - stepPenalty - logPenalty - sideEffectPenalty),
    0,
    100,
  );
  const band: DiagramQuality['band'] = score >= 75 ? 'good' : score >= 50 ? 'ok' : 'noisy';
  return { score, band };
}

function reasonsFromMetrics(metrics: DiagramQualityMetrics): string[] {
  const reasons: string[] = [];
  const logCount = Math.round(metrics.logRatio * Math.max(metrics.stepCountDetailed, 1));

  if (metrics.stepCountDetailed >= 60) {
    reasons.push(`High step count (${String(metrics.stepCountDetailed)}). Consider summary mode.`);
  } else if (metrics.stepCountDetailed >= 35) {
    reasons.push(`Moderate step count (${String(metrics.stepCountDetailed)}). Summary mode may improve readability.`);
  }

  if (logCount >= 12 || metrics.logRatio >= 0.35) {
    reasons.push(`Many log steps (${String(logCount)}). Consider collapsing logs or summary mode.`);
  }

  if (metrics.anonymousNodeCount >= 5) {
    reasons.push(`${String(metrics.anonymousNodeCount)} anonymous nodes from pipe chains or unnamed calls.`);
  }

  if (metrics.unknownNodeCount > 0) {
    reasons.push(`${String(metrics.unknownNodeCount)} unresolved nodes may reduce diagram clarity.`);
  }

  if (metrics.serviceCallCount >= 3 && metrics.namedServiceCallRatio < 0.7) {
    reasons.push(
      `Service call naming clarity is ${(metrics.namedServiceCallRatio * 100).toFixed(0)}% (${String(metrics.serviceCallCount)} calls).`,
    );
  }

  return reasons;
}

function tipsFromMetrics(metrics: DiagramQualityMetrics): string[] {
  const tips: string[] = [];
  const logCount = Math.round(metrics.logRatio * Math.max(metrics.stepCountDetailed, 1));

  if (metrics.stepCountDetailed >= 35) {
    tips.push('For larger programs, consider summary mode.');
  }
  if (logCount >= 12 || metrics.logRatio >= 0.35) {
    tips.push('For larger programs, consider grouping logs or using summary mode.');
  }
  if (metrics.anonymousNodeCount >= 5) {
    tips.push('Consider naming intermediate values or extracting named helpers.');
  }
  if (metrics.pipeChainCount >= 4 || metrics.maxPipeChainLength >= 6) {
    tips.push('If you want clearer diagrams, consider splitting long pipe chains into named steps.');
  }
  if (metrics.serviceCallCount >= 3 && metrics.namedServiceCallRatio < 0.7) {
    tips.push('Consider naming service-call intermediates to make boundaries explicit.');
  }

  return uniqueCapped(tips.map(normalizeTip), MAX_PROGRAM_TIPS);
}

export function computeProgramDiagramQuality(
  ir: StaticEffectIR,
  options: DiagramQualityOptions = {},
): DiagramQuality {
  const metrics = computeMetrics(ir, options);
  const { score, band } = scoreFromMetrics(metrics);
  const reasons = reasonsFromMetrics(metrics);
  const tips = tipsFromMetrics(metrics);

  const hintReasons = options.hints?.reasons ?? [];
  const hintTips = (options.hints?.tips ?? []).map(normalizeTip);

  return {
    score,
    band,
    metrics,
    reasons: uniqueCapped([...reasons, ...hintReasons], 8),
    tips: uniqueCapped([...tips, ...hintTips], MAX_PROGRAM_TIPS),
  };
}

function aggregateMetrics(qualities: readonly DiagramQuality[]): DiagramQualityMetrics {
  if (qualities.length === 0) {
    return {
      stepCountDetailed: 0,
      stepCountSummary: 0,
      collapsedGroupsSummary: 0,
      logRatio: 0,
      sideEffectRatio: 0,
      anonymousNodeCount: 0,
      anonymousRatio: 0,
      unknownNodeCount: 0,
      serviceCallCount: 0,
      namedServiceCallRatio: 0,
      pipeChainCount: 0,
      maxPipeChainLength: 0,
    };
  }

  const weights = qualities.map((q) => Math.max(1, q.metrics.stepCountDetailed));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const weightedAvg = (picker: (q: DiagramQuality) => number): number =>
    qualities.reduce((sum, q, i) => sum + picker(q) * (weights[i] ?? 1), 0) / totalWeight;
  const weightedSum = (picker: (q: DiagramQuality) => number): number =>
    qualities.reduce((sum, q) => sum + picker(q), 0);

  return {
    stepCountDetailed: Math.round(weightedAvg((q) => q.metrics.stepCountDetailed)),
    stepCountSummary: Math.round(weightedAvg((q) => q.metrics.stepCountSummary)),
    collapsedGroupsSummary: Math.round(weightedAvg((q) => q.metrics.collapsedGroupsSummary)),
    logRatio: weightedAvg((q) => q.metrics.logRatio),
    sideEffectRatio: weightedAvg((q) => q.metrics.sideEffectRatio),
    anonymousNodeCount: Math.round(weightedSum((q) => q.metrics.anonymousNodeCount)),
    anonymousRatio: weightedAvg((q) => q.metrics.anonymousRatio),
    unknownNodeCount: Math.round(weightedSum((q) => q.metrics.unknownNodeCount)),
    serviceCallCount: Math.round(weightedSum((q) => q.metrics.serviceCallCount)),
    namedServiceCallRatio: weightedAvg((q) => q.metrics.namedServiceCallRatio),
    pipeChainCount: Math.round(weightedSum((q) => q.metrics.pipeChainCount)),
    maxPipeChainLength: Math.max(...qualities.map((q) => q.metrics.maxPipeChainLength)),
  };
}

export function computeFileDiagramQuality(
  filePath: string,
  programs: readonly StaticEffectIR[],
  options: DiagramQualityOptions = {},
): DiagramQualityWithFile {
  const programQualities = programs.map((ir) => computeProgramDiagramQuality(ir, options));
  const metrics = aggregateMetrics(programQualities);
  const weightedScore = programQualities.length > 0
    ? Math.round(
        programQualities.reduce(
          (sum, q) => sum + q.score * Math.max(1, q.metrics.stepCountDetailed),
          0,
        ) /
          programQualities.reduce((sum, q) => sum + Math.max(1, q.metrics.stepCountDetailed), 0),
      )
    : 100;

  const band: DiagramQuality['band'] =
    weightedScore >= 75 ? 'good' : weightedScore >= 50 ? 'ok' : 'noisy';

  const reasons = uniqueCapped(
    [
      ...reasonsFromMetrics(metrics),
      ...(options.hints?.reasons ?? []),
    ],
    10,
  );
  const tips = uniqueCapped(
    [
      ...tipsFromMetrics(metrics),
      ...((options.hints?.tips ?? []).map(normalizeTip)),
    ].filter(startsWithAllowedTipPrefix),
    MAX_FILE_TIPS,
  );

  return {
    filePath,
    quality: {
      score: weightedScore,
      band,
      metrics,
      reasons,
      tips,
    },
  };
}

function makeEntry(filePath: string, metricValue: number, tip: string): DiagramTopOffenderEntry {
  return {
    filePath,
    metricValue,
    tip: normalizeTip(tip),
  };
}

function rankTop(
  entries: readonly DiagramQualityWithFile[],
  valueOf: (q: DiagramQualityWithFile) => number,
  tip: (q: DiagramQualityWithFile) => string,
  topN: number,
): DiagramTopOffenderEntry[] {
  return [...entries]
    .sort((a, b) => {
      const dv = valueOf(b) - valueOf(a);
      if (dv !== 0) return dv;
      return a.filePath.localeCompare(b.filePath);
    })
    .slice(0, topN)
    .map((q) => makeEntry(q.filePath, valueOf(q), tip(q)));
}

export function buildTopOffendersReport(
  fileQualities: readonly DiagramQualityWithFile[],
  topN = 10,
): DiagramTopOffendersReport {
  const capped = clamp(topN, 1, 50);
  return {
    largestPrograms: rankTop(
      fileQualities,
      (q) => q.quality.metrics.stepCountDetailed,
      () => 'For larger programs, consider summary mode.',
      capped,
    ),
    mostAnonymousNodes: rankTop(
      fileQualities,
      (q) => q.quality.metrics.anonymousNodeCount,
      () => 'Consider naming intermediate values or extracting named helpers.',
      capped,
    ),
    mostUnknownNodes: rankTop(
      fileQualities,
      (q) => q.quality.metrics.unknownNodeCount,
      () => 'If you want clearer diagrams, consider extracting helpers to reduce unresolved nodes.',
      capped,
    ),
    highestLogRatio: rankTop(
      fileQualities,
      (q) => q.quality.metrics.logRatio,
      () => 'For larger programs, consider grouping logs or using summary mode.',
      capped,
    ),
  };
}

