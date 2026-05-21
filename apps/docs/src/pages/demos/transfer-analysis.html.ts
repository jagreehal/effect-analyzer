import { resolve } from 'node:path';
import { Effect } from 'effect';
import { analyze, renderInteractiveHTML } from '../../../../../packages/effect-analyzer/dist/index.js';

export const prerender = true;

export async function GET(): Promise<Response> {
  const samplePath = resolve(process.cwd(), 'samples/transfer.ts');

  const ir = await Effect.runPromise(analyze(samplePath).named('transfer'));
  const html = renderInteractiveHTML(ir, {
    title: 'Transfer Analysis',
    theme: 'midnight',
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
