import { describe, expect, it } from 'vitest';
import { makeRetainer } from './analysis-retention';

describe('makeRetainer', () => {
  it('reports a successful analysis as ready', () => {
    const retainer = makeRetainer<string>();
    expect(retainer.succeed('diagram')).toEqual({
      status: 'ready',
      value: 'diagram',
      diagnostics: [],
    });
  });

  it('fails outright when nothing good has been seen yet', () => {
    const retainer = makeRetainer<string>();
    expect(retainer.fail('Unexpected token')).toEqual({
      status: 'failed',
      value: undefined,
      diagnostics: ['Unexpected token'],
    });
  });

  // The point of the whole module: a file saved mid-edit must not blank the
  // last good render.
  it('keeps the last good value and degrades to partial', () => {
    const retainer = makeRetainer<string>();
    retainer.succeed('diagram');
    expect(retainer.fail('Unexpected token')).toEqual({
      status: 'partial',
      value: 'diagram',
      diagnostics: ['Unexpected token'],
    });
  });

  it('recovers to ready once the source parses again', () => {
    const retainer = makeRetainer<string>();
    retainer.succeed('v1');
    retainer.fail('broken');
    expect(retainer.succeed('v2')).toEqual({
      status: 'ready',
      value: 'v2',
      diagnostics: [],
    });
  });

  it('accumulates repeated failures against the same retained value', () => {
    const retainer = makeRetainer<string>();
    retainer.succeed('v1');
    retainer.fail('first');
    expect(retainer.fail('second')).toEqual({
      status: 'partial',
      value: 'v1',
      diagnostics: ['second'],
    });
  });

  it('exposes the retained value without recording an attempt', () => {
    const retainer = makeRetainer<string>();
    expect(retainer.latest()).toBeUndefined();
    retainer.succeed('v1');
    expect(retainer.latest()).toBe('v1');
    retainer.fail('broken');
    expect(retainer.latest()).toBe('v1');
  });
});
