import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const VALID_SOURCE = `
import { Effect } from 'effect';
export const checkout = Effect.gen(function* () {
  yield* Effect.succeed('paid');
});
`;

const waitFor = async (read: () => string, needle: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (!read().includes(needle)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${JSON.stringify(needle)}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
};

describe('effect-analyze --watch', () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let root: string | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('keeps the initial valid diagram when the first watched save is incomplete', async () => {
    root = mkdtempSync(join(tmpdir(), 'effect-analyzer-watch-'));
    const source = join(root, 'checkout.ts');
    writeFileSync(source, VALID_SOURCE, 'utf8');

    child = spawn(
      process.execPath,
      [resolve(__dirname, '..', 'dist', 'cli.js'), source, '--watch', '--format', 'mermaid', '--quiet'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.resume();

    await waitFor(() => stdout, 'flowchart');
    expect(stdout).toContain('Watching');

    // Editors commonly save by replacing the file. The brief missing-file
    // window must be treated like any other incomplete save.
    rmSync(source);
    await waitFor(() => stdout, 'Error:');

    const currentFrame = stdout.slice(stdout.lastIndexOf('\x1Bc'));
    expect(currentFrame).toContain('flowchart');
    expect(currentFrame).toContain('Showing the last valid analysis');
  }, 20_000);

  // Watch mode renders through `captureStdout`, which swaps the global
  // `process.stdout.write`. Overlapping analyses restore it in the order they
  // finish, so a burst of saves used to be able to leave stdout pointing at a
  // capture buffer nobody reads — every later frame written into the void, the
  // watcher alive but permanently silent. A burst must not cost us the frames
  // that come after it.
  it('still renders after a burst of rapid saves', async () => {
    root = mkdtempSync(join(tmpdir(), 'effect-analyzer-burst-'));
    const source = join(root, 'checkout.ts');
    writeFileSync(source, VALID_SOURCE, 'utf8');

    child = spawn(
      process.execPath,
      [resolve(__dirname, '..', 'dist', 'cli.js'), source, '--watch', '--format', 'mermaid', '--quiet'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.resume();

    await waitFor(() => stdout, 'flowchart');

    // Spread across several debounce windows on purpose: coalescing within one
    // window is exactly what would hide the bug.
    for (let save = 0; save < 8; save += 1) {
      writeFileSync(source, `${VALID_SOURCE}\n// burst ${String(save)}\n`, 'utf8');
      await new Promise((settle) => setTimeout(settle, 200));
    }

    // A uniquely named node inside the *first* program is the proof: it can
    // only appear in a frame rendered after the burst, so seeing it means
    // stdout still reaches the terminal. It has to be a node in that program
    // rather than a new export, because `--format mermaid` only draws the
    // first program it finds.
    const marker = 'reconcileLedger';
    writeFileSync(
      source,
      `
import { Effect } from 'effect';
const ${marker} = Effect.succeed('done');
export const checkout = Effect.gen(function* () {
  yield* Effect.succeed('paid');
  yield* ${marker};
});
`,
      'utf8',
    );
    await waitFor(() => stdout, marker);

    const currentFrame = stdout.slice(stdout.lastIndexOf('\x1Bc'));
    expect(currentFrame).toContain(marker);
  }, 30_000);
});
