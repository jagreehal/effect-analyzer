/**
 * Pure classifier and parsing helpers used by the analyzer.
 *
 * These functions are intentionally side-effect-free and do not call back
 * into the rest of the analyzer pipeline, which is why they live in their
 * own module — keeping effect-analysis.ts focused on tree-walking logic.
 *
 * Extracted from effect-analysis.ts as part of the strangler-fig cleanup.
 * Behaviour is preserved exactly.
 */

import type { ObjectLiteralExpression, PropertyAssignment } from 'ts-morph';
import { loadTsMorph } from './ts-morph-loader';
import type {
  ConcurrencyMode,
  ScheduleInfo,
  ChannelOperatorInfo,
  SinkOperatorInfo,
} from './types';

/** Classify Channel.* operation (improve.md §8). */
export function channelOpCategory(op: string): ChannelOperatorInfo['category'] {
  if (
    op === 'fromReadableStream' ||
    op === 'fromWritableStream' ||
    op === 'fromDuplexStream' ||
    op === 'make' ||
    op === 'succeed' ||
    op === 'fail' ||
    op === 'empty' ||
    op === 'never'
  )
    return 'constructor';
  if (
    op.includes('map') ||
    op.includes('flatMap') ||
    op.includes('filter') ||
    op.includes('concat') ||
    op.includes('zip')
  )
    return 'transform';
  if (op.includes('pipe') || op === 'pipeTo' || op === 'pipeThrough') return 'pipe';
  return 'other';
}

/** Classify Sink.* operation (improve.md §8). */
export function sinkOpCategory(op: string): SinkOperatorInfo['category'] {
  if (
    op === 'forEach' ||
    op === 'forEachWhile' ||
    op === 'run' ||
    op === 'runDrain' ||
    op === 'runFor' ||
    op === 'make' ||
    op === 'fromEffect' ||
    op === 'fromQueue'
  )
    return 'constructor';
  if (
    op.includes('map') ||
    op.includes('contramap') ||
    op.includes('filter') ||
    op.includes('zip')
  )
    return 'transform';
  return 'other';
}

/** Parse Effect.all options object: concurrency, batching, discard (GAP 18). */
export function parseEffectAllOptions(
  optionsNode: ObjectLiteralExpression,
): {
  concurrency: ConcurrencyMode | undefined;
  batching: boolean | undefined;
  discard: boolean | undefined;
} {
  const { SyntaxKind } = loadTsMorph();
  let concurrency: ConcurrencyMode | undefined;
  let batching: boolean | undefined;
  let discard: boolean | undefined;
  for (const prop of optionsNode.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const name = (prop as PropertyAssignment).getNameNode().getText();
    const init = (prop as PropertyAssignment).getInitializer();
    if (!init) continue;
    const text = init.getText();
    if (name === 'concurrency') {
      if (text === '"unbounded"' || text === "'unbounded'") concurrency = 'unbounded';
      else if (text === '"sequential"' || text === "'sequential'") concurrency = 'sequential';
      else if (text === '"inherit"' || text === "'inherit'") concurrency = 'sequential';
      else {
        const n = Number.parseInt(text, 10);
        if (!Number.isNaN(n) && n >= 0) concurrency = n;
      }
    } else if (name === 'batching' && (text === 'true' || text === 'false')) {
      batching = text === 'true';
    } else if (name === 'discard' && (text === 'true' || text === 'false')) {
      discard = text === 'true';
    }
  }
  return { concurrency, batching, discard };
}

/** Parse schedule expression text into ScheduleInfo (GAP 8). */
export function parseScheduleInfo(scheduleText: string): ScheduleInfo | undefined {
  const t = scheduleText.replace(/\s+/g, ' ');
  let baseStrategy: ScheduleInfo['baseStrategy'] = 'custom';
  if (t.includes('Schedule.exponential') || t.includes('exponential(')) baseStrategy = 'exponential';
  else if (t.includes('Schedule.fibonacci') || t.includes('fibonacci(')) baseStrategy = 'fibonacci';
  else if (t.includes('Schedule.spaced') || t.includes('spaced(')) baseStrategy = 'spaced';
  else if (t.includes('Schedule.fixed') || t.includes('fixed(')) baseStrategy = 'fixed';
  else if (t.includes('Schedule.linear') || t.includes('linear(')) baseStrategy = 'linear';
  else if (t.includes('Schedule.cron') || t.includes('cron(')) baseStrategy = 'cron';
  else if (t.includes('Schedule.windowed') || t.includes('windowed(')) baseStrategy = 'windowed';
  else if (t.includes('Schedule.duration') || t.includes('duration(')) baseStrategy = 'duration';
  else if (t.includes('Schedule.elapsed') || t.includes('elapsed(')) baseStrategy = 'elapsed';
  else if (t.includes('Schedule.delays') || t.includes('delays(')) baseStrategy = 'delays';
  else if (t.includes('Schedule.once') || t.includes('once(')) baseStrategy = 'once';
  else if (t.includes('Schedule.stop') || t.includes('stop(')) baseStrategy = 'stop';
  else if (t.includes('Schedule.count') || t.includes('count(')) baseStrategy = 'count';

  let maxRetries: number | 'unlimited' | undefined;
  const recursMatch = /recurs\s*\(\s*(\d+)\s*\)/.exec(t);
  if (recursMatch) maxRetries = Number.parseInt(recursMatch[1]!, 10);
  const recurUpToMatch = /recurUpTo\s*\(\s*(\d+)\s*\)/.exec(t);
  if (recurUpToMatch) maxRetries = Number.parseInt(recurUpToMatch[1]!, 10);
  else if (t.includes('forever') || t.includes('Schedule.forever')) maxRetries = 'unlimited';

  const jittered = t.includes('jittered') || t.includes('Schedule.jittered');
  const conditions: string[] = [];
  if (t.includes('whileInput')) conditions.push('whileInput');
  if (t.includes('whileOutput')) conditions.push('whileOutput');
  if (t.includes('untilInput')) conditions.push('untilInput');
  if (t.includes('untilOutput')) conditions.push('untilOutput');
  if (t.includes('recurUntil')) conditions.push('recurUntil');
  if (t.includes('recurWhile')) conditions.push('recurWhile');
  if (t.includes('andThen')) conditions.push('andThen');
  if (t.includes('intersect')) conditions.push('intersect');
  if (t.includes('union')) conditions.push('union');
  if (t.includes('compose')) conditions.push('compose');
  if (t.includes('zipWith')) conditions.push('zipWith');
  if (t.includes('addDelay')) conditions.push('addDelay');
  if (t.includes('modifyDelay')) conditions.push('modifyDelay');
  if (t.includes('check')) conditions.push('check');
  if (t.includes('resetAfter')) conditions.push('resetAfter');
  if (t.includes('resetWhen')) conditions.push('resetWhen');
  if (t.includes('ensure')) conditions.push('ensure');
  if (t.includes('driver')) conditions.push('driver');
  if (t.includes('mapInput')) conditions.push('mapInput');

  return {
    baseStrategy,
    maxRetries,
    jittered,
    conditions,
  };
}
