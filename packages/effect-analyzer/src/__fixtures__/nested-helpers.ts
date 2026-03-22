/**
 * Nested helper and nested generator fixture.
 */

import { Effect } from 'effect';

const parseInput = (raw: string) =>
  Effect.try({
    try: () => {
      if (raw.trim().length === 0) {
        throw new Error('EmptyInput');
      }
      return raw.trim();
    },
    catch: () => new Error('ParseFailed'),
  });

const normalizeEmail = (email: string) =>
  Effect.gen(function* () {
    const lower = email.toLowerCase();
    return lower;
  });

const persistUser = (email: string) =>
  Effect.gen(function* () {
    yield* Effect.log(`Persisting ${email}`);
    return { id: 'user-1', email };
  });

export const nestedHelperProgram = (rawEmail: string) =>
  Effect.gen(function* () {
    const parsed = yield* parseInput(rawEmail);
    const normalized = yield* normalizeEmail(parsed);
    const user = yield* persistUser(normalized);
    return user;
  });

export const nestedMain = nestedHelperProgram('TeSt@Example.com');
