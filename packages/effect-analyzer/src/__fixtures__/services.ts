import { Context, Effect, Layer } from 'effect';

export type User = {
  readonly id: string;
  readonly name: string;
};

export type NotFound = {
  readonly _tag: 'NotFound';
  readonly id: string;
};

export type RepoCrash = {
  readonly _tag: 'RepoCrash';
  readonly reason: string;
};

export class UserRepo extends Context.Tag('Fixtures/UserRepo')<
  UserRepo,
  {
    readonly getUser: (id: string) => Effect.Effect<User, NotFound | RepoCrash>;
    readonly saveAudit: (message: string) => Effect.Effect<void>;
  }
>() {}

export class AppConfig extends Context.Tag('Fixtures/AppConfig')<
  AppConfig,
  {
    readonly defaultUserId: string;
    readonly retryCount: number;
  }
>() {}

export class CustomService extends Context.Tag('Fixtures/CustomService')<
  CustomService,
  {
    readonly doWork: (id: string) => Effect.Effect<number>;
    readonly buildProfile: (id: string) => Effect.Effect<string>;
  }
>() {}

export class Db extends Context.Tag('Fixtures/Db')<
  Db,
  {
    readonly query: (sql: string) => Effect.Effect<string>;
  }
>() {}

export const UserRepoLive = Layer.succeed(UserRepo, {
  getUser: (id: string) =>
    id === 'missing'
      ? Effect.fail<NotFound>({ _tag: 'NotFound', id })
      : id === 'explode'
      ? Effect.fail<RepoCrash>({ _tag: 'RepoCrash', reason: 'db exploded' })
      : Effect.succeed({ id, name: `user:${id}` }),
  saveAudit: (_message: string) => Effect.void,
});

export const AppConfigLive = Layer.succeed(AppConfig, {
  defaultUserId: 'u-1',
  retryCount: 2,
});

export const CustomServiceLive = Layer.succeed(CustomService, {
  doWork: (id: string) => Effect.succeed(id.length),
  buildProfile: (id: string) => Effect.succeed(`profile:${id}`),
});

export const DbLive = Layer.effect(
  Db,
  Effect.succeed({
    query: (sql: string) => Effect.succeed(`row:${sql}`),
  }),
);

export const AppLayer = Layer.mergeAll(
  UserRepoLive,
  AppConfigLive,
  CustomServiceLive,
  DbLive,
);
