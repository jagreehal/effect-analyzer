/**
 * Gap 6: JavaScript file with Effect code - analyzer supports .js/.jsx via extensions option.
 */
const { Effect } = require('effect');

const jsProgram = Effect.gen(function* () {
  const n = yield* Effect.succeed(1);
  return n + 1;
});
