import { describe, it, expect } from 'vitest';
import { analyzeConfigSensitivitySource } from './config-sensitivity';

describe('config-sensitivity', () => {
  it('detects Config.redacted source', () => {
    const r = analyzeConfigSensitivitySource(
      `import { Config } from 'effect';
       const apiKey = Config.redacted('API_KEY');`,
    );
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]?.variableName).toBe('apiKey');
    expect(r.sources[0]?.sensitivity).toBe('redacted');
    expect(r.leaks).toEqual([]);
  });

  it('detects Config.secret source', () => {
    const r = analyzeConfigSensitivitySource(
      `import { Config } from 'effect';
       const dbPwd = Config.secret('DB_PWD');`,
    );
    expect(r.sources[0]?.sensitivity).toBe('secret');
  });

  it('flags redacted value flowing into Effect.log', () => {
    const r = analyzeConfigSensitivitySource(
      `import { Effect, Config } from 'effect';
       const apiKey = Config.redacted('API_KEY');
       export const prog = Effect.gen(function* () {
         const key = yield* apiKey;
         yield* Effect.logInfo('using key', apiKey);
       });`,
    );
    expect(r.leaks.length).toBeGreaterThan(0);
    expect(r.leaks[0]?.variableName).toBe('apiKey');
    expect(r.leaks[0]?.sinkCallee).toBe('Effect.logInfo');
  });

  it('flags redacted value flowing into console.log', () => {
    const r = analyzeConfigSensitivitySource(
      `import { Config } from 'effect';
       const apiKey = Config.redacted('API_KEY');
       console.log('hello', apiKey);`,
    );
    expect(r.leaks).toHaveLength(1);
    expect(r.leaks[0]?.sinkCallee).toBe('console.log');
  });

  it('does not flag non-sensitive references in logs', () => {
    const r = analyzeConfigSensitivitySource(
      `import { Effect, Config } from 'effect';
       const port = Config.integer('PORT');
       export const prog = Effect.logInfo('starting on', port);`,
    );
    expect(r.leaks).toEqual([]);
  });
});
