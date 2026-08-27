/**
 * Isolated runtime probes.
 *
 * Static analysis has to re-derive things Effect already knows exactly — the
 * JSON Schema of a `Schema`, the shape of a `Layer`. A probe asks the real
 * value instead, by importing one module in a separate short-lived process.
 *
 * The isolation is the point: the target's top-level code runs, so it must not
 * share this process. Probing is opt-in for that reason — see
 * `SECURITY_NOTE` — and every failure comes back as a value, never a crash.
 */

import { spawn } from 'child_process';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Data, Effect } from 'effect';

/** Importing a module executes it. Surfaced wherever probing is offered. */
export const SECURITY_NOTE =
  'Runtime probing imports the target module, which runs its top-level code. Only probe projects you trust.';

/** Questions a probe can answer about a module. */
export type ProbeRequest =
  | { readonly kind: 'exports' }
  | { readonly kind: 'json-schema'; readonly exportName: string };

export class RuntimeProbeError extends Data.TaggedError('RuntimeProbeError')<{
  readonly filePath: string;
  readonly reason: string;
}> {}

export interface ProbeOptions {
  /** Directory the probe runs in; `effect` resolves from here. */
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

const RUNNER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'runtime-probe-runner.mjs',
);

/**
 * The TypeScript loader, resolved from this package's own pinned dependency.
 *
 * Not `npx tsx`: a clean or offline consumer install has no npx cache to fall
 * back on, and an online one would download and execute whatever `tsx@latest`
 * happens to be that day — arbitrary code, chosen at run time, around a feature
 * whose whole point is isolation. Spawning `process.execPath` with an absolute
 * path also means probing does not depend on `PATH` resolving anything.
 *
 * Resolved on first use rather than at import: this module is reachable from
 * the CLI entry point, and probing is one opt-in feature of many. A loader that
 * cannot be resolved must fail the probe as a typed error, the way every other
 * failure here does — not take the whole CLI down before it parses its
 * arguments.
 */
let tsxCli: string | undefined;
const resolveTsxCli = (): string => (tsxCli ??= createRequire(import.meta.url).resolve('tsx/cli'));

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ask one question about one module.
 *
 * The result is `unknown` on purpose: it crossed a process boundary as JSON and
 * nothing has checked its shape. Narrow it with a decoder — see
 * `probeJsonSchema` — rather than asserting a type here.
 */
export const probeRuntime = (
  filePath: string,
  request: ProbeRequest,
  options: ProbeOptions = {},
): Effect.Effect<unknown, RuntimeProbeError> =>
  Effect.callback<unknown, RuntimeProbeError>((
    resume: (effect: Effect.Effect<unknown, RuntimeProbeError>) => void,
  ) => {
    let loader: string;
    try {
      loader = resolveTsxCli();
    } catch (cause) {
      resume(
        Effect.fail(
          new RuntimeProbeError({
            filePath,
            reason: `Could not resolve the tsx loader: ${(cause as Error).message}`,
          }),
        ),
      );
      return Effect.void;
    }

    const child = spawn(
      process.execPath,
      [loader, RUNNER, filePath, JSON.stringify(request)],
      {
        cwd: options.cwd ?? process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group: `tsx` re-spawns node to install its loaders, so
        // the probed module is a grandchild and killing the direct child alone
        // leaves it running and holding the pipes.
        detached: true,
      },
    );

    /** Kill the whole group, falling back to the child where groups do not exist. */
    const kill = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Whichever of the timeout and the child's exit lands first wins; the other
    // is ignored rather than resuming a second time.
    let settled = false;
    const bail = (reason: string): void => {
      if (settled) return;
      settled = true;
      resume(Effect.fail(new RuntimeProbeError({ filePath, reason })));
    };
    const succeed = (value: unknown): void => {
      if (settled) return;
      settled = true;
      resume(Effect.succeed(value));
    };

    // A plain timer, not Effect.sleep: this guards a child process from inside
    // an Effect.callback, so it must fire on the Node timer queue.
    // oxlint-disable-next-line effecttsgo/global-timers-in-effect
    const timer = setTimeout(() => {
      kill();
      // Fail here rather than waiting for `close`: a killed process can leave
      // the pipes held open, and then `close` never arrives at all.
      bail('Probe timed out');
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.on('error', (error) => {
      clearTimeout(timer);
      bail(`Could not start the probe: ${error.message}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const trimmed = stdout.trim();
      if (trimmed === '') {
        bail(
          `Probe produced no output (exit ${String(code)})${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
        );
        return;
      }
      let parsed: { ok: boolean; value?: unknown; error?: string };
      try {
        parsed = JSON.parse(trimmed) as typeof parsed;
      } catch {
        bail(`Probe output was not JSON: ${trimmed.slice(0, 200)}`);
        return;
      }
      if (!parsed.ok) {
        bail(parsed.error ?? 'Probe failed');
        return;
      }
      succeed(parsed.value);
    });

    return Effect.sync(() => {
      clearTimeout(timer);
      kill();
    });
  });

/** Canonical JSON Schema document, straight from `Schema.toJsonSchemaDocument`. */
export interface JsonSchemaDocument {
  readonly dialect: string;
  readonly schema: Record<string, unknown>;
  readonly definitions: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrow probe output to a JSON Schema document, or say why it is not one. */
const decodeJsonSchemaDocument = (
  filePath: string,
  value: unknown,
): Effect.Effect<JsonSchemaDocument, RuntimeProbeError> => {
  const reject = (reason: string): Effect.Effect<never, RuntimeProbeError> =>
    Effect.fail(new RuntimeProbeError({ filePath, reason }));
  if (!isRecord(value)) return reject('Probe returned a non-object JSON Schema document');
  if (typeof value['dialect'] !== 'string') return reject('JSON Schema document has no dialect');
  if (!isRecord(value['schema'])) return reject('JSON Schema document has no schema');
  return Effect.succeed({
    dialect: value['dialect'],
    schema: value['schema'],
    definitions: isRecord(value['definitions']) ? value['definitions'] : {},
  });
};

/**
 * The exact JSON Schema of an exported `Schema`. Prefer this over the static
 * walker when running the project is acceptable: it comes from Effect itself,
 * so refinements, annotations and transformations are all reflected.
 */
export const probeJsonSchema = (
  filePath: string,
  exportName: string,
  options?: ProbeOptions,
): Effect.Effect<JsonSchemaDocument, RuntimeProbeError> =>
  probeRuntime(filePath, { kind: 'json-schema', exportName }, options).pipe(
    Effect.flatMap((value) => decodeJsonSchemaDocument(filePath, value)),
  );
