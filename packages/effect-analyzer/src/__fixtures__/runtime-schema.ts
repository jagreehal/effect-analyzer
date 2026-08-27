/**
 * Fixture: a Schema carrying constraints that only exist at runtime — a
 * refinement and an annotation the static walker cannot see.
 */
import { Schema } from 'effect';

export const User = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.Number,
  tags: Schema.Array(Schema.String),
});
