/**
 * Observability Analysis (GAP 11)
 *
 * Detects Effect.withSpan, Effect.log*, Metric.*, Logger usage.
 */

import type { StaticEffectIR, StaticFlowNode } from './types';
import { getStaticChildren } from './types';
import { Option } from 'effect';

// =============================================================================
// Types
// =============================================================================

export interface SpanInfo {
  nodeId: string;
  name?: string;
  location?: { line: number; column: number };
}

export interface LogPointInfo {
  nodeId: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  location?: { line: number; column: number };
}

export interface MetricInfo {
  nodeId: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary' | 'timer';
  /** Whether this metric uses Metric.tagged / taggedWithLabels */
  isTagged?: boolean;
  location?: { line: number; column: number };
}

export interface ObservabilityAnalysis {
  spans: SpanInfo[];
  logPoints: LogPointInfo[];
  metrics: MetricInfo[];
  coverage: {
    effectCount: number;
    effectsWithSpans: number;
    effectsWithMetrics: number;
    errorHandlersWithLogging: number;
    errorHandlerCount: number;
  };
}

// =============================================================================
// Analysis
// =============================================================================

function isSpanCallee(callee: string): boolean {
  return (
    callee.includes('withSpan') ||
    callee.includes('Tracer.span') ||
    callee.includes('annotateCurrentSpan') ||
    callee.includes('annotateSpans') ||
    callee.includes('makeSpan') ||
    callee.includes('makeSpanScoped') ||
    callee.includes('useSpan') ||
    callee.includes('withParentSpan') ||
    callee.includes('linkSpans') ||
    callee.includes('linkSpanCurrent') ||
    callee.includes('functionWithSpan') ||
    callee.includes('currentSpan') ||
    callee.includes('currentParentSpan') ||
    callee.includes('withTracerEnabled') ||
    callee.includes('withTracerTiming') ||
    callee.includes('span(')
  );
}

function isLogCallee(callee: string): boolean {
  return (
    callee.includes('Effect.log') ||
    callee.includes('Logger.add') ||
    callee.includes('Logger.replace') ||
    callee.includes('Logger.batched') ||
    callee.includes('Logger.withLeveledConsole') ||
    callee.includes('Logger.json') ||
    callee.includes('Logger.logFmt') ||
    callee.includes('Logger.pretty') ||
    callee.includes('Logger.structured')
  );
}

function getLogLevel(callee: string): LogPointInfo['level'] {
  if (callee.includes('logDebug') || callee.includes('Debug')) return 'debug';
  if (callee.includes('logWarning') || callee.includes('Warning')) return 'warning';
  if (callee.includes('logError') || callee.includes('Error')) return 'error';
  return 'info';
}

function isMetricCallee(callee: string): boolean {
  return callee.startsWith('Metric.') || callee.includes('.track');
}

function getMetricType(callee: string): MetricInfo['type'] {
  if (callee.includes('counter') || callee.includes('increment')) return 'counter';
  if (callee.includes('frequency')) return 'counter';
  if (callee.includes('gauge') || callee.includes('.set')) return 'gauge';
  if (callee.includes('histogram')) return 'histogram';
  if (callee.includes('summary')) return 'summary';
  if (callee.includes('timer') || callee.includes('trackDuration')) return 'timer';
  // Metric combinators — type unknown, default to counter
  // tagged, taggedWithLabels, trackAll, trackDefect, withConstantInput, map, mapInput
  return 'counter';
}

export function analyzeObservability(ir: StaticEffectIR): ObservabilityAnalysis {
  const spans: SpanInfo[] = [];
  const logPoints: LogPointInfo[] = [];
  const metrics: MetricInfo[] = [];
  let effectCount = 0;
  let effectsWithSpans = 0;
  let effectsWithMetrics = 0;
  let errorHandlersWithLogging = 0;
  let errorHandlerCount = 0;

  function visit(nodes: readonly StaticFlowNode[], underSpan: boolean, underMetric: boolean) {
    for (const node of nodes) {
      if (node.type === 'effect') {
        const eff = node;
        const callee = eff.callee ?? '';
        effectCount++;
        if (isSpanCallee(callee)) {
          const s: SpanInfo = { nodeId: eff.id };
          if (eff.location) s.location = { line: eff.location.line, column: eff.location.column };
          spans.push(s);
        }
        if (underSpan) effectsWithSpans++;
        if (isLogCallee(callee)) {
          const lp: LogPointInfo = { nodeId: eff.id, level: getLogLevel(callee) };
          if (eff.location) lp.location = { line: eff.location.line, column: eff.location.column };
          logPoints.push(lp);
        }
        if (isMetricCallee(callee)) {
          const isTagged = callee.includes('tagged') || callee.includes('taggedWith');
          const m: MetricInfo = {
            nodeId: eff.id,
            type: getMetricType(callee),
            ...(isTagged ? { isTagged: true } : {}),
          };
          if (eff.location) m.location = { line: eff.location.line, column: eff.location.column };
          metrics.push(m);
        }
        if (underMetric) effectsWithMetrics++;
      }
      if (node.type === 'error-handler') {
        errorHandlerCount++;
        const handler = node;
        if (handler.handler) {
          let hasLog = false;
          const checkLog = (n: StaticFlowNode) => {
            if (n.type === 'effect') {
              const c = (n).callee ?? '';
              if (isLogCallee(c)) hasLog = true;
            }
            const ch = Option.getOrElse(getStaticChildren(n), () => []);
            ch.forEach(checkLog);
          };
          checkLog(handler.handler);
          if (hasLog) errorHandlersWithLogging++;
        }
      }
      const children = Option.getOrElse(getStaticChildren(node), () => []);
      const thisIsSpan = node.type === 'effect' && isSpanCallee((node).callee ?? '');
      const thisIsMetric = node.type === 'effect' && isMetricCallee((node).callee ?? '');
      const nextUnderSpan = underSpan || thisIsSpan;
      const nextUnderMetric = underMetric || thisIsMetric;
      if (children.length > 0) visit(children, nextUnderSpan, nextUnderMetric);
    }
  }
  visit(ir.root.children, false, false);

  return {
    spans,
    logPoints,
    metrics,
    coverage: {
      effectCount,
      effectsWithSpans,
      effectsWithMetrics,
      errorHandlersWithLogging,
      errorHandlerCount,
    },
  };
}
