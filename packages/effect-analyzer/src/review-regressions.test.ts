import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { Cause, Effect, Result } from 'effect';
import { analyze } from './analyze';
import { getStaticChildren, type StaticFlowNode } from './types';

describe('review regressions', () => {
  const findFirstByType = <T extends StaticFlowNode['type']>(
    nodes: readonly StaticFlowNode[],
    type: T,
  ): Extract<StaticFlowNode, { type: T }> | undefined => {
    const directChildren = (node: StaticFlowNode): readonly StaticFlowNode[] => {
      if (node.type === 'pipe') return [node.initial, ...node.transformations];
      if (node.type === 'parallel' || node.type === 'race') return node.children;
      if (node.type === 'generator') return node.yields.map((y) => y.effect);
      if (node.type === 'layer') return node.operations;
      return getStaticChildren(node) ?? [];
    };

    const stack = [...nodes];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (node.type === type) return node as Extract<StaticFlowNode, { type: T }>;
      const children = directChildren(node);
      for (const child of children) stack.push(child);
    }
    return undefined;
  };

  const readFixture = (name: string): string =>
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf-8');

  it('does not classify arbitrary top-level run* wrappers as Effect entrypoints', async () => {
    const source = `
function runTask(x: number) {
  return x + 1;
}

runTask(1);
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      const error = Cause.findError(exit.cause);
      expect(Result.isSuccess(error)).toBe(true);
      if (Result.isSuccess(error)) {
        expect(error.success).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
      }
    }
  });

  it('detects programs created via bare named imports from effect modules', async () => {
    const source = `
import { succeed } from "effect/Effect";

const program = succeed(1);
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    const program = results.find((ir) => ir.root.programName === 'program');
    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('high');
  });

  it('detects awaited programs created via bare named imports from effect modules', async () => {
    const source = `
import { succeed } from "effect/Effect";

const program = await succeed(1);
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('program');
  });

  it('does not classify non-Effect calls with names containing "pipe" as direct programs', async () => {
    const source = `
function pipeline(x: number) {
  return x + 1;
}

const program = pipeline(1);
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not classify exact pipe(...) utility transforms without Effect-like inputs', async () => {
    const source = `
function pipe<A, B>(value: A, f: (a: A) => B): B {
  return f(value);
}

const result = pipe([1, 2, 3], (xs) => xs.map((x) => x + 1));
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not classify plain object literals as direct programs only because nested methods use Effect', async () => {
    const source = `
import * as Effect from "effect/Effect";

const service = {
  healthcheck() {
    return Effect.succeed("ok");
  }
};
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('analyzes Effect.gen adapter yields (yield* _(effect)) as normal effects', async () => {
    const source = `
import { Effect, Console } from "effect";

export const program = Effect.gen(function* (_) {
  const n = yield* _(Effect.succeed(1));
  yield* _(Console.log(String(n)));
  return n;
});
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'program');
    expect(program).toBeDefined();
    const gen = program?.root.children.find((child) => child.type === 'generator');
    expect(gen?.type).toBe('generator');
    if (gen?.type === 'generator') {
      expect(gen.yields.length).toBeGreaterThanOrEqual(2);
      expect(gen.yields[0]?.effect.type).toBe('effect');
      if (gen.yields[0]?.effect.type === 'effect') {
        expect(gen.yields[0].effect.callee).toBe('Effect.succeed');
      }
      expect(gen.yields[1]?.effect.type).toBe('effect');
    }
  });

  it('classifies yielded TaggedError instances as Effect.fail steps', async () => {
    const source = `
import { Effect, Schema } from "effect";

class ShortenError extends Schema.TaggedError<ShortenError>()("ShortenError", {
  reason: Schema.String
}) {}

export const program = Effect.gen(function* () {
  yield* new ShortenError({ reason: "TooLarge" });
});
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'program');
    expect(program).toBeDefined();
    const gen = program?.root.children.find((child) => child.type === 'generator');
    expect(gen?.type).toBe('generator');
    if (gen?.type === 'generator') {
      expect(gen.yields.length).toBeGreaterThanOrEqual(1);
      const first = gen.yields[0]?.effect;
      expect(first?.type).toBe('effect');
      if (first?.type === 'effect') {
        expect(first.callee).toBe('Effect.fail');
        expect(first.errorType).toBe('ShortenError');
      }
    }
  });

  it('collects all dependencies from Layer.provide array arguments', async () => {
    const source = `
import { Layer, Context } from "effect";

class FetchHttpClient extends Context.Tag("FetchHttpClient")<FetchHttpClient, { readonly get: () => void }>() {}
class RpcSerialization extends Context.Tag("RpcSerialization")<RpcSerialization, { readonly json: () => void }>() {}
class RpcClient extends Context.Tag("RpcClient")<RpcClient, { readonly call: () => void }>() {}

const clientLayer = Layer.succeed(RpcClient, { call: () => {} }).pipe(
  Layer.provide([
    Layer.succeed(FetchHttpClient, { get: () => {} }),
    Layer.succeed(RpcSerialization, { json: () => {} })
  ])
);
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const ir = results.find((x) => x.root.programName === 'clientLayer');
    expect(ir).toBeDefined();
    const layer = ir ? findFirstByType(ir.root.children, 'layer') : undefined;
    expect(layer?.type).toBe('layer');
    if (layer?.type === 'layer') {
      const req = new Set(layer.requires ?? []);
      expect(req.has('FetchHttpClient')).toBe(true);
      expect(req.has('RpcSerialization')).toBe(true);
    }
  });

  it('classifies Layer.unwrapEffect(Effect.gen(...)) with explicit unwrapEffect layer semantics', async () => {
    const source = `
import { Layer, Effect } from "effect";

export const TracingLayer = Layer.unwrapEffect(
  Effect.gen(function*() {
    return Layer.empty;
  })
);
`;
    const results = await Effect.runPromise(analyze.source(source).all());
    const ir = results.find((x) => x.root.programName === 'TracingLayer');
    expect(ir).toBeDefined();
    const layer = ir ? findFirstByType(ir.root.children, 'layer') : undefined;
    expect(layer?.type).toBe('layer');
    if (layer?.type === 'layer') {
      expect(layer.name).toBe('Layer.unwrapEffect(gen)');
    }
  });

  it('models RpcClient.layerProtocolHttp(...).pipe(Layer.provide([...])) as a pipe with layer dependencies', async () => {
    const source = `
import { Layer, Context } from "effect";

class FetchHttpClient extends Context.Tag("FetchHttpClient")<FetchHttpClient, { readonly get: () => void }>() {}
class RpcSerialization extends Context.Tag("RpcSerialization")<RpcSerialization, { readonly json: () => void }>() {}

const RpcClient = {
  layerProtocolHttp: (_: { url: string }) => Layer.empty
};

export const clientLayer = RpcClient.layerProtocolHttp({ url: "/api/rpc/" }).pipe(
  Layer.provide([
    Layer.succeed(FetchHttpClient, { get: () => {} }),
    Layer.succeed(RpcSerialization, { json: () => {} })
  ])
);
`;
    const results = await Effect.runPromise(analyze.source(source).all());
    const ir = results.find((x) => x.root.programName === 'clientLayer');
    expect(ir).toBeDefined();
    const pipe = ir?.root.children.find((n) => n.type === 'pipe');
    expect(pipe?.type).toBe('pipe');
    if (pipe?.type === 'pipe') {
      expect(pipe.initial.type).toBe('layer');
      const provided = pipe.transformations.find((t) => t.type === 'layer');
      expect(provided?.type).toBe('layer');
      if (provided?.type === 'layer') {
        const req = new Set(provided.requires ?? []);
        expect(req.has('FetchHttpClient')).toBe(true);
        expect(req.has('RpcSerialization')).toBe(true);
      }
    }
  });

  it('attaches medium confidence to exact pipe-based discovery', async () => {
    const source = `
import { pipe, Effect } from "effect";

export const program = pipe(
  Effect.succeed(1),
  Effect.map((n) => n + 1)
);
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'program');

    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('medium');
    expect(program?.root.discoveryReason).toContain('pipe');
  });

  it('does not classify function wrappers that execute effects via runSync as direct programs', async () => {
    const source = `
import * as Effect from "effect/Effect";

const program = Effect.succeed(1);
const runNow = () => {
  return Effect.runSync(program);
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).toContain('program');
    expect(results.map((ir) => ir.root.programName)).not.toContain('runNow');
  });

  it('still classifies functions that return an Effect even if they also call runSync internally', async () => {
    const source = `
import * as Effect from "effect/Effect";

const program = () => {
  Effect.runSync(Effect.sync(() => {}));
  return Effect.succeed(1);
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).toContain('program');
  });

  it('still classifies functions with control-flow Effect returns even if runSync appears in the body', async () => {
    const source = `
import * as Effect from "effect/Effect";

const program = (flag: boolean) => {
  if (flag) {
    return Effect.succeed(1);
  }
  Effect.runSync(Effect.sync(() => {}));
  return Effect.succeed(2);
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).toContain('program');
  });

  it('still classifies functions whose Effect returns are only inside nested branches when runSync is also present', async () => {
    const source = `
import * as Effect from "effect/Effect";

const program = (flag: boolean) => {
  Effect.runSync(Effect.sync(() => {}));
  if (flag) {
    return Effect.succeed(1);
  } else {
    return Effect.succeed(2);
  }
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).toContain('program');
  });

  it('does not treat nested callback returns as outer function Effect returns', async () => {
    const source = `
import * as Effect from "effect/Effect";

const helper = () => {
  const thunk = () => {
    return Effect.succeed(1);
  };
  return 123;
};
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not let nested callback runSync suppress outer body-effect detection', async () => {
    const source = `
import * as Effect from "effect/Effect";

const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });

export const fromCallback = dual(1, () => {
  const helper = () => Effect.runSync(Effect.sync(() => {}));
  helper();
  const effect = Effect.succeed(1);
  return { effect };
});
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).toContain('fromCallback');
  });

  it('does not treat nested getter returns as outer function Effect returns', async () => {
    const source = `
import * as Effect from "effect/Effect";

const helper = () => {
  const obj = {
    get value() {
      return Effect.succeed(1);
    }
  };
  return obj;
};
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not treat nested class field Effect initializers as outer function body effects', async () => {
    const source = `
import * as Effect from "effect/Effect";

const helper = () => {
  class Local {
    value = Effect.succeed(1);
  }
  return Local;
};
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not treat nested class static block Effect calls as outer function body effects', async () => {
    const source = `
import * as Effect from "effect/Effect";

const helper = () => {
  class Local {
    static {
      Effect.runSync(Effect.succeed(1));
    }
  }
  return Local;
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    expect(results.map((ir) => ir.root.programName)).not.toContain('helper');
  });

  it('upgrades confidence for explicit Effect return type annotations on function exports (Effect.ts-style log wrappers)', async () => {
    const source = `
import * as Effect from "effect/Effect";

export const logWithLevel = (level: string): Effect.Effect<void> =>
  Effect.log(level);
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'logWithLevel');

    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('high');
    expect(program?.root.discoveryReason).toContain('annotated');
  });

  it('upgrades confidence for typed dual-style exports that return Effect-family values (Effect.ts-style request helpers)', async () => {
    const source = `
import * as Effect from "effect/Effect";
const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });

export const request: {
  (id: string): Effect.Effect<number>;
  (self: number, id: string): Effect.Effect<number>;
} = dual(2, (_self: number, _id: string) => Effect.succeed(1));
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'request');

    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('high');
    expect(program?.root.discoveryReason).toContain('type annotation');
  });

  it('upgrades confidence for exports with bare Layer<...> type annotations (Layer.ts-style)', async () => {
    const source = `
import * as Effect from "effect/Effect";
type Layer<A = never, E = never, R = never> = { _A?: A; _E?: E; _R?: R };

export const setRandom = (): Layer<never> => {
  return Effect.succeed(undefined);
};
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'setRandom');

    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('high');
    expect(program?.root.discoveryReason).toMatch(/Effect-family|annotated/);
  });

  it('supports onlyExportedPrograms to suppress local helper discoveries in source files', async () => {
    const source = `
import * as Effect from "effect/Effect";

const helper = Effect.succeed(1);
export const program = Effect.succeed(2);
`;

    const results = await Effect.runPromise(
      analyze.source(source, { onlyExportedPrograms: true }).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toEqual(['program']);
  });

  it('supports minDiscoveryConfidence to filter heuristic-only discoveries', async () => {
    const source = `
const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });
export const maybeEffect = dual(2, (_x: number) => ({ x: _x }));
`;

    const exit = await Effect.runPromiseExit(
      analyze.source(source, { minDiscoveryConfidence: 'medium' }).all(),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('upgrades exported typed function APIs to at least medium confidence (Effect.fn-style)', async () => {
    const source = `
import * as Effect from "effect/Effect";

export const fn:
  & ((name: string) => (n: number) => Effect.Effect<number>)
  & ((n: number) => Effect.Effect<number>) =
  function(nameOrBody: string | ((n: number) => Effect.Effect<number>)) {
    return typeof nameOrBody === "string"
      ? (n: number) => Effect.succeed(n)
      : nameOrBody;
  };
`;

    const results = await Effect.runPromise(analyze.source(source).all());
    const program = results.find((ir) => ir.root.programName === 'fn');

    expect(program).toBeDefined();
    expect(['medium', 'high']).toContain(program?.root.discoveryConfidence);
    expect(program?.root.discoveryReason).toMatch(/exported|Effect-family|annotated/);
  });

  it('detects chained local builder calls with effectful callbacks (internal/dataSource-style)', async () => {
    const source = `
import * as Effect from "effect/Effect";

const make = (runAll: () => unknown) => ({
  identified: (_name: string) => ({ runAll })
});

export const never = make(() => Effect.never).identified("Never");
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('never');
  });

  it('detects dual-style constructors when callback body contains Effect calls but returns object literal (core-stream-style)', async () => {
    const source = `
import * as Effect from "effect/Effect";

const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });

export const fromEffect = dual(1, () => {
  const effect = Effect.succeed(1);
  return { effect };
});
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('fromEffect');
  });

  it('detects direct initializers from local relative Effect module namespace imports (channelState-style)', async () => {
    const source = `
import * as Effect from "../../Effect.js";

export const effect = Effect.void;
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('effect');
  });

  it('detects conditional-return effect helpers using local relative Effect namespace imports (channelState-style)', async () => {
    const source = `
import * as Effect from "../../Effect.js";

const isFromEffect = (_self: unknown) => false;

export const effect = <E, R>(self: { effect: unknown }) =>
  isFromEffect(self) ? self.effect as Effect.Effect<void, E, R> : Effect.void;
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('effect');
  });

  it('detects dual-style callbacks returning object literals with nested Effect/Stream calls (Subscribable.ts-style)', async () => {
    const source = `
import * as Effect from "./Effect.js";
import * as Stream from "./Stream.js";
import { dual } from "./Function.js";

const make = (options: unknown) => options;

export const map = dual(2, (self: { get: unknown; changes: unknown }, f: (a: unknown) => unknown) =>
  make({
    get: Effect.map(self.get as never, f as never),
    changes: Stream.map(self.changes as never, f as never)
  }));
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('map');
  });

  it('does not classify object-literal method wrappers as Effect programs without Effect calls', async () => {
    const source = `
const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });
const make = (options: unknown) => options;

export const map = dual(2, () =>
  make({
    value: 1,
    method() {
      return 2;
    }
  }));
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not classify iterable-style computed iterator object wrappers as Effect programs (Iterable.ts-style)', async () => {
    const source = `
const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });

export const appendAll = dual(2, () => ({
  [Symbol.iterator]() {
    return {
      next() {
        return { done: true, value: undefined };
      }
    };
  }
}));
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('detects wrapper calls whose object-literal arguments contain nested Effect calls (logger-circular-style)', async () => {
    const source = `
import * as Effect from "effect/Effect";
const dual = (..._args: ReadonlyArray<unknown>) => ({ tag: "dual" });

export const test = dual(2, (self: { log: (input: unknown) => unknown }) =>
  self.log({
    value: Effect.succeed(1),
    tag: "x"
  }));
`;

    const results = await Effect.runPromise(analyze.source(source).all());

    expect(results.map((ir) => ir.root.programName)).toContain('test');
  });

  it('does not classify plain Option constructors as Effect programs (utility-module false positive)', async () => {
    const source = `
import * as Option from "effect/Option";

const value = Option.some(1);
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not classify plain Chunk constructors as Effect programs (utility-module false positive)', async () => {
    const source = `
import * as Chunk from "effect/Chunk";

const value = Chunk.of(1);
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('does not classify plain Exit constructors as Effect programs (utility-module false positive)', async () => {
    const source = `
import * as Exit from "effect/Exit";

const value = Exit.succeed(1);
`;

    const exit = await Effect.runPromiseExit(analyze.source(source).all());

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });

  it('detects direct initializers from local Effect internal namespace aliases (Layer.ts-style)', async () => {
    const source = `
import * as internal from "./internal/layer.js";

export const build = internal.build;
`;

    const results = await Effect.runPromise(
      analyze.source(source, {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    const program = results.find((ir) => ir.root.programName === 'build');
    expect(program).toBeDefined();
    expect(program?.root.discoveryConfidence).toBe('high');
    expect(program?.root.discoveryReason).toContain('knownEffectInternalsRoot');
  });

  it('detects direct initializers from local internal schedule namespace aliases (Schedule.ts-style)', async () => {
    const source = `
import * as internal from "./internal/schedule.js";

export const once = internal.once;
`;

    const results = await Effect.runPromise(
      analyze.source(source, {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toContain('once');
  });

  it('detects direct initializers from local internal mailbox namespace aliases (Mailbox.ts-style)', async () => {
    const source = `
import * as internal from "./internal/mailbox.js";

export const toStream = internal.toStream;
`;

    const results = await Effect.runPromise(
      analyze.source(source, {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toContain('toStream');
  });

  it('detects direct initializers from local internal pubsub namespace aliases (PubSub.ts-style)', async () => {
    const source = `
import * as internal from "./internal/pubsub.js";

export const subscribe = internal.subscribe;
`;

    const results = await Effect.runPromise(
      analyze.source(source, {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toContain('subscribe');
  });

  it('detects direct initializers from nested local internal stm namespace aliases (TQueue.ts-style)', async () => {
    const source = `
import * as internal from "./internal/stm/tQueue.js";

export const bounded = internal.bounded;
`;

    const results = await Effect.runPromise(
      analyze.source(source, {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toContain('bounded');
  });

  it('covers regression fixture: internal namespace aliases (top-level + nested)', async () => {
    const topLevel = await Effect.runPromise(
      analyze.source(readFixture('regression-internal-aliases.ts'), {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );
    const nested = await Effect.runPromise(
      analyze.source(readFixture('regression-nested-internal-aliases.ts'), {
        knownEffectInternalsRoot: '/tmp/fake-effect-root/internal',
      }).all(),
    );

    expect(topLevel.map((ir) => ir.root.programName)).toEqual(
      expect.arrayContaining(['build', 'subscribe']),
    );
    expect(nested.map((ir) => ir.root.programName)).toContain('bounded');
  });

  it('covers regression fixture: bare named imports (direct + awaited)', async () => {
    const results = await Effect.runPromise(
      analyze.source(readFixture('regression-bare-named-imports.ts')).all(),
    );

    expect(results.map((ir) => ir.root.programName)).toEqual(
      expect.arrayContaining(['directProgram', 'awaitedProgram']),
    );
  });

  it('covers regression fixture: non-Effect pipeline false positive guard', async () => {
    const exit = await Effect.runPromiseExit(
      analyze.source(readFixture('regression-false-positive-pipeline.ts')).all(),
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toMatchObject({ code: 'NO_EFFECTS_FOUND' });
    }
  });
});
