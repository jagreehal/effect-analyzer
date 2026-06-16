// The same service, migrated to Effect — one pattern at a time, in the order
// the migration assistant reported them.
//
//   class (manual DI)  -> Context.Tag + Layer
//   process.env        -> Config
//   try/catch + throw  -> typed error channel (Data.TaggedError + Effect.fail)
//   fetch()            -> HttpClient
//   Promise.all        -> Effect.all({ concurrency })
//   setTimeout         -> Effect.sleep / forked fiber
//
// This is the destination. The tutorial walks through getting here; the point
// of the analyzer is that it tells you *exactly* what to change and where.

import { HttpClient, HttpClientResponse } from '@effect/platform';
import { Config, Context, Data, Duration, Effect, Layer, Schema } from 'effect';

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});
type User = typeof User.Type;

const Order = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  total: Schema.Number,
});
type Order = typeof Order.Type;

// try/catch + `throw new Error` becomes a typed error in the error channel.
class UserFetchError extends Data.TaggedError('UserFetchError')<{
  readonly userId: string;
  readonly status?: number;
}> {}

// process.env -> Config: the base URL is now declared, typed config.
const baseUrl = Config.string('API_URL').pipe(
  Config.withDefault('https://api.example.com'),
);

// class UserService (manual DI) -> Context.Tag + Layer.
export class UserService extends Context.Tag('UserService')<
  UserService,
  {
    readonly getUser: (id: string) => Effect.Effect<User, UserFetchError>;
    readonly getOrders: (userId: string) => Effect.Effect<readonly Order[], UserFetchError>;
  }
>() {}

export const UserServiceLive = Layer.effect(
  UserService,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const url = yield* baseUrl;

    const getUser = (id: string) =>
      http.get(`${url}/users/${id}`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
        // No try/catch: failures land in the typed error channel.
        Effect.mapError(() => new UserFetchError({ userId: id })),
      );

    const getOrders = (userId: string) =>
      http.get(`${url}/users/${userId}/orders`).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Order))),
        Effect.mapError(() => new UserFetchError({ userId })),
      );

    return { getUser, getOrders };
  }),
);

// class ReportService (manual DI) -> Context.Tag + Layer.
export class ReportService extends Context.Tag('ReportService')<
  ReportService,
  { readonly buildSummary: (userId: string) => Effect.Effect<string, UserFetchError> }
>() {}

export const ReportServiceLive = Layer.effect(
  ReportService,
  Effect.gen(function* () {
    const users = yield* UserService;

    const buildSummary = (userId: string) =>
      Effect.gen(function* () {
        // Promise.all -> Effect.all with explicit, bounded concurrency.
        const [user, orders] = yield* Effect.all(
          [users.getUser(userId), users.getOrders(userId)],
          { concurrency: 2 },
        );

        const total = orders.reduce((sum, o) => sum + o.total, 0);

        // setTimeout side effect -> a sleep, forked so it doesn't block the result.
        yield* Effect.fork(
          Effect.sleep(Duration.seconds(1)).pipe(
            Effect.zipRight(Effect.log(`flushed analytics for ${user.id}`)),
          ),
        );

        return `${user.name} has ${orders.length} orders worth ${total}`;
      });

    return { buildSummary };
  }),
);

export const ReportServiceWiring = ReportServiceLive.pipe(
  Layer.provide(UserServiceLive),
);
