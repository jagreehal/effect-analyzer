/** Normalize Effect v4 and OpenTelemetry spans for static diagram overlays. */

import { Exit, Option } from 'effect';
import type * as Tracer from 'effect/Tracer';

export type RuntimeSpanStatus = 'running' | 'success' | 'error';

export interface RuntimeTraceSpan {
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly name: string;
  readonly path: readonly string[];
  readonly status: RuntimeSpanStatus;
  readonly durationMs?: number | undefined;
}

export interface RuntimeTrace {
  readonly spans: readonly RuntimeTraceSpan[];
}

interface FlatSpan {
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly name: string;
  readonly status: RuntimeSpanStatus;
  readonly durationMs?: number | undefined;
}

const addPaths = (spans: readonly FlatSpan[]): RuntimeTrace => {
  const byId = new Map(spans.map((span) => [span.spanId, span] as const));
  const pathFor = (span: FlatSpan, seen = new Set<string>()): readonly string[] => {
    if (!span.parentSpanId || seen.has(span.spanId)) return [span.name];
    const parent = byId.get(span.parentSpanId);
    if (!parent) return [span.name];
    seen.add(span.spanId);
    return [...pathFor(parent, seen), span.name];
  };
  return {
    spans: spans.map((span) => ({ ...span, path: pathFor(span) })),
  };
};

/** Adapter for Effect v4 native/devtools span values. */
export const traceFromEffectSpans = (
  spans: readonly Tracer.Span[],
): RuntimeTrace => addPaths(spans.map((span) => {
  const parent = Option.getOrUndefined(span.parent);
  const ended = span.status._tag === 'Ended';
  return {
    spanId: span.spanId,
    ...(parent ? { parentSpanId: parent.spanId } : {}),
    name: span.name,
    status: ended
      ? Exit.isSuccess(span.status.exit) ? 'success' as const : 'error' as const
      : 'running' as const,
    ...(ended
      ? { durationMs: Number(span.status.endTime - span.status.startTime) / 1_000_000 }
      : {}),
  };
}));

export interface OpenTelemetryReadableSpan {
  readonly name: string;
  readonly spanContext: () => { readonly spanId: string };
  readonly parentSpanContext?: { readonly spanId: string } | undefined;
  readonly status?: { readonly code: number } | undefined;
  readonly startTime?: readonly [number, number] | undefined;
  readonly endTime?: readonly [number, number] | undefined;
}

const hrDurationMs = (
  start: readonly [number, number] | undefined,
  end: readonly [number, number] | undefined,
): number | undefined => {
  if (!start || !end) return undefined;
  return (end[0] - start[0]) * 1_000 + (end[1] - start[1]) / 1_000_000;
};

/** Adapter for OpenTelemetry ReadableSpan-shaped exports. */
export const traceFromOpenTelemetry = (
  spans: readonly OpenTelemetryReadableSpan[],
): RuntimeTrace => addPaths(spans.map((span) => ({
  spanId: span.spanContext().spanId,
  ...(span.parentSpanContext ? { parentSpanId: span.parentSpanContext.spanId } : {}),
  name: span.name,
  status: span.status?.code === 2 ? 'error' : 'success',
  ...(() => {
    const durationMs = hrDurationMs(span.startTime, span.endTime);
    return durationMs === undefined ? {} : { durationMs };
  })(),
})));
