/**
 * Wrapper-based bootstrap (improve.md §9): runApp(AppLive) pattern.
 */
import { Effect, Layer } from 'effect';
import * as NodeRuntime from '@effect/platform-node/NodeRuntime';

const AppLive = Layer.succeed('App', { run: () => 'ok' });

function runApp(layer: Layer.Layer<unknown>) {
  return layer.pipe(Layer.launch, NodeRuntime.runMain);
}

runApp(AppLive);

export const program = Effect.gen(function* () {
  yield* Effect.succeed(1);
});
