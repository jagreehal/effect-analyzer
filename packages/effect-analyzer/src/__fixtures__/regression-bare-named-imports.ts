import { succeed } from 'effect/Effect';

export const directProgram = succeed(1);
export const awaitedProgram = await succeed(2);
