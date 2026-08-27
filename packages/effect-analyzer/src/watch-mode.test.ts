import { describe, expect, it } from 'vitest';
import { makeRetainer } from './analysis-retention';
import { frameFor, makeRefreshQueue } from './watch-mode';

// eslint-disable-next-line no-control-regex -- stripping ANSI colour is the point
const strip = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('frameFor', () => {
  it('shows the analysis when the source is good', () => {
    const retainer = makeRetainer<string>();
    const frame = frameFor(retainer.succeed('flowchart LR'));
    expect(frame.body).toBe('flowchart LR');
    expect(frame.trailer.map(strip)).toEqual(['', '✓ Updated. Waiting for changes...']);
  });

  // `failed` means the current source is broken and nothing good preceded it.
  // A stale value must not leak onto the screen even if one is somehow attached.
  it('shows no body for a failed result regardless of any retained value', () => {
    const frame = frameFor({ status: 'failed', value: 'stale', diagnostics: ['boom'] });
    expect(frame.body).toBe('');
  });

  // The whole point: a save mid-edit must not blank the diagram.
  it('keeps the last good analysis on screen when the source breaks', () => {
    const retainer = makeRetainer<string>();
    retainer.succeed('flowchart LR');
    const frame = frameFor(retainer.fail('Unexpected token'));
    expect(frame.body).toBe('flowchart LR');
    expect(frame.trailer.map(strip)).toEqual([
      '⚠ Showing the last valid analysis while this file is incomplete.',
      '✗ Error: Unexpected token',
      'Waiting for changes...',
    ]);
  });

  it('shows only the error when nothing good has been rendered yet', () => {
    const retainer = makeRetainer<string>();
    const frame = frameFor(retainer.fail('Unexpected token'));
    expect(frame.body).toBe('');
    expect(frame.trailer.map(strip)).toEqual([
      '✗ Error: Unexpected token',
      'Waiting for changes...',
    ]);
  });
});

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('makeRefreshQueue', () => {
  // `captureStdout` swaps the global `process.stdout.write`. Two overlapping
  // analyses restore in the order they *finish*, so the later one hands back a
  // capture function that is already dead — and every write after that is
  // swallowed. The queue is what makes overlap impossible.
  it('never runs two refreshes at once', async () => {
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const trigger = makeRefreshQueue(() => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<void>((done) => {
        pending.push(() => {
          active -= 1;
          done();
        });
      });
    });

    trigger();
    trigger();
    await tick();
    expect(peak).toBe(1);
    expect(pending).toHaveLength(1);

    pending.shift()?.();
    await tick();
    expect(peak).toBe(1);
    expect(pending).toHaveLength(1);

    pending.shift()?.();
    await tick();
    expect(active).toBe(0);
  });

  // Only the newest state on disk is worth rendering, so a burst arriving
  // mid-run must collapse to one follow-up rather than queue a redundant
  // analysis per event and flicker through stale frames.
  it('collapses a burst arriving mid-run into a single follow-up', async () => {
    let runs = 0;
    const pending: Array<() => void> = [];
    const trigger = makeRefreshQueue(() => {
      runs += 1;
      return new Promise<void>((done) => pending.push(done));
    });

    trigger();
    await tick();
    expect(runs).toBe(1);

    trigger();
    trigger();
    trigger();
    await tick();
    expect(runs).toBe(1);

    pending.shift()?.();
    await tick();
    expect(runs).toBe(2);

    pending.shift()?.();
    await tick();
    expect(runs).toBe(2);
    expect(pending).toHaveLength(0);
  });

  // The two failure modes either side of coalescing: a lone change must not
  // run twice, and — the dangerous one — the queue must still work once it has
  // drained. A `running` flag that never clears leaves the watcher alive and
  // permanently idle, which looks exactly like a watcher with nothing to do.
  it('runs once per change and still refreshes after the queue drains', async () => {
    let runs = 0;
    const pending: Array<() => void> = [];
    const trigger = makeRefreshQueue(() => {
      runs += 1;
      return new Promise<void>((done) => pending.push(done));
    });

    trigger();
    await tick();
    expect(runs).toBe(1);

    pending.shift()?.();
    await tick();
    expect(runs).toBe(1);

    trigger();
    await tick();
    expect(runs).toBe(2);

    pending.shift()?.();
    await tick();
    expect(runs).toBe(2);
  });
});
