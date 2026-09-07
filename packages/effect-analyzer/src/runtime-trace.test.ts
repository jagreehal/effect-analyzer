import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import { analyze } from './analyze';
import { traceFromSpanTree } from './runtime-trace';
import { renderMermaidWithRuntimeTrace } from './output/mermaid';

describe('traceFromSpanTree', () => {
  it('derives span paths from the nested tree and maps status', () => {
    const trace = traceFromSpanTree({
      spans: [
        {
          spanId: 'a',
          name: 'transfer',
          status: 'error',
          durationMs: 12,
          running: false,
          children: [
            { spanId: 'b', name: 'debit', status: 'ok', durationMs: 3, children: [] },
            { spanId: 'c', name: 'credit', status: 'unset', running: true, durationMs: null },
          ],
        },
      ],
    });

    expect(trace.spans).toEqual([
      { spanId: 'a', name: 'transfer', status: 'error', durationMs: 12, path: ['transfer'] },
      {
        spanId: 'b',
        parentSpanId: 'a',
        name: 'debit',
        status: 'success',
        durationMs: 3,
        path: ['transfer', 'debit'],
      },
      {
        spanId: 'c',
        parentSpanId: 'a',
        name: 'credit',
        status: 'running',
        path: ['transfer', 'credit'],
      },
    ]);
  });

  it('overlays onto a static diagram by span path', async () => {
    const ir = await Effect.runPromise(
      analyze.source(`
        import { Effect } from "effect";

        export const program = Effect.gen(function* () {
          yield* Effect.succeed(1).pipe(Effect.withSpan("debit"));
        }).pipe(Effect.withSpan("transfer"));
      `).single,
    );

    const overlay = renderMermaidWithRuntimeTrace(
      ir,
      traceFromSpanTree({
        spans: [
          {
            spanId: 'a',
            name: 'transfer',
            status: 'ok',
            children: [{ spanId: 'b', name: 'debit', status: 'error' }],
          },
        ],
      }),
    );

    // "transfer" wraps the whole program, so it has no static node of its own;
    // "debit" still matches once its ancestor segment is dropped.
    expect(overlay.suffixMatchedSpanIds).toEqual(['b']);
    expect(overlay.unmatchedSpanIds).toEqual(['a']);
    expect(overlay.ambiguousSpanIds).toEqual([]);
    expect(overlay.mermaid).toContain('trace_error');
  });
});
