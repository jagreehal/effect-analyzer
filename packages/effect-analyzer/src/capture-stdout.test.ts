// This file deliberately reads `process.stdout.write` as a property to assert
// the exact function object is restored, so unbound-method does not apply.
/* oxlint-disable typescript/unbound-method */
import { Data, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { captureStdout } from './capture-stdout';

class Boom extends Data.TaggedError('Boom')<{ readonly why: string }> {}

describe('captureStdout', () => {
  it('returns what the effect wrote instead of printing it', async () => {
    const captured = await Effect.runPromise(
      captureStdout(
        Effect.sync(() => {
          process.stdout.write('flowchart LR\n');
          process.stdout.write('  A --> B\n');
        }),
      ),
    );
    expect(captured).toBe('flowchart LR\n  A --> B\n');
  });

  it('restores the real stdout when the effect fails', async () => {
    const before = process.stdout.write;
    const exit = await Effect.runPromiseExit(
      captureStdout(Effect.fail(new Boom({ why: 'boom' }))),
    );
    expect(exit._tag).toBe('Failure');
    expect(process.stdout.write).toBe(before);
  });

  it('restores the real stdout when the effect dies', async () => {
    const before = process.stdout.write;
    await Effect.runPromiseExit(
      captureStdout(
        Effect.sync(() => {
          throw new Error('defect');
        }),
      ),
    );
    expect(process.stdout.write).toBe(before);
  });

  it('decodes Uint8Array chunks and reports the write as accepted', async () => {
    let accepted: boolean | undefined;
    const captured = await Effect.runPromise(
      captureStdout(
        Effect.sync(() => {
          accepted = process.stdout.write(Buffer.from('graph TD\n', 'utf8'));
        }),
      ),
    );
    expect(captured).toBe('graph TD\n');
    expect(accepted).toBe(true);
  });
});
