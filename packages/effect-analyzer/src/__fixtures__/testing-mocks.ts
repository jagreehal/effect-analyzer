/**
 * Test-style fixture with Layer-backed service mocks.
 */

import { Context, Effect, Layer } from 'effect';

interface UserRepo {
  readonly getById: (id: string) => Effect.Effect<{ id: string; email: string }>;
}

export class UserRepoService extends Context.Tag('UserRepoService')<
  UserRepoService,
  UserRepo
>() {}

const liveRepoLayer = Layer.succeed(UserRepoService, {
  getById: (id: string) =>
    Effect.succeed({ id, email: `${id}@example.com` }),
});

const mockRepoLayer = Layer.succeed(UserRepoService, {
  getById: (id: string) =>
    Effect.succeed({ id, email: `mock+${id}@example.com` }),
});

export const userLookupProgram = Effect.gen(function* () {
  const repo = yield* UserRepoService;
  const user = yield* repo.getById('u-42');
  return user.email;
});

export const withLiveLayer = Effect.provide(userLookupProgram, liveRepoLayer);
export const withMockLayer = Effect.provide(userLookupProgram, mockRepoLayer);
