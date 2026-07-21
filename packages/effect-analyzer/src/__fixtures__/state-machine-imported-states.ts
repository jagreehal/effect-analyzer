import { Schema } from 'effect';

export class IdleState extends Schema.TaggedClass<IdleState>()('Idle', {}) {}
export class RunningState extends Schema.TaggedClass<RunningState>()(
  'Running',
  {},
) {}
