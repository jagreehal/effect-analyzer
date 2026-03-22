/**
 * Real-world Effect patterns - API service implementation
 * 
 * This fixture demonstrates realistic Effect usage:
 * - HTTP client with retry and timeout
 * - Database operations with transactions
 * - Caching layer
 * - Authentication/authorization
 * - Rate limiting
 */

import {
  Effect,
  Context,
  Layer,
  Schema,
  Schedule,
  Ref,
  Option,
} from 'effect';

// =============================================================================
// Domain Types
// =============================================================================

export class UserId extends Context.Tag('UserId')<UserId, string>() {}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

// =============================================================================
// Services
// =============================================================================

/**
 * HTTP client service
 */
export class HttpClient extends Context.Tag('HttpClient')<
  HttpClient,
  {
    readonly get: <A>(url: string) => Effect.Effect<A, HttpError>;
    readonly post: <A>(url: string, body: unknown) => Effect.Effect<A, HttpError>;
    readonly put: <A>(url: string, body: unknown) => Effect.Effect<A, HttpError>;
    readonly delete: (url: string) => Effect.Effect<void, HttpError>;
  }
>() {}

/**
 * Cache service
 */
export class Cache extends Context.Tag('Cache')<
  Cache,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<unknown>>;
    readonly set: (key: string, value: unknown, ttl?: number) => Effect.Effect<void>;
    readonly delete: (key: string) => Effect.Effect<void>;
  }
>() {}

/**
 * Rate limiter service
 */
export class RateLimiter extends Context.Tag('RateLimiter')<
  RateLimiter,
  {
    readonly acquire: Effect.Effect<void, RateLimitError>;
    readonly release: Effect.Effect<void>;
  }
>() {}

// =============================================================================
// Error Types - Plain objects with _tag
// =============================================================================

export interface HttpError {
  readonly _tag: 'HttpError';
  readonly status: number;
  readonly message: string;
}

export interface RateLimitError {
  readonly _tag: 'RateLimitError';
  readonly retryAfter: number;
}

export interface AuthError {
  readonly _tag: 'AuthError';
  readonly reason: string;
}

// =============================================================================
// Real-World Programs
// =============================================================================

/**
 * API call with retry and timeout
 */
export const apiCallWithRetry = <A>(
  makeRequest: Effect.Effect<A, HttpError>
): Effect.Effect<A, HttpError | RateLimitError, RateLimiter> =>
  Effect.gen(function* () {
    const rateLimiter = yield* RateLimiter;

    yield* rateLimiter.acquire;

    const result = yield* makeRequest.pipe(
      Effect.retry({
        schedule: Schedule.exponential('1 second').pipe(
          Schedule.intersect(Schedule.recurs(3))
        ),
      }),
      Effect.ensuring(rateLimiter.release)
    );

    return result;
  });

/**
 * Cached API call
 */
export const cachedApiCall = <A>(
  key: string,
  makeRequest: Effect.Effect<A, HttpError>
): Effect.Effect<A, HttpError, Cache> =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    
    const cached = yield* cache.get(key);
    
    if (Option.isSome(cached)) {
      return cached.value as A;
    }
    
    const result = yield* makeRequest;
    yield* cache.set(key, result, 300); // 5 minute TTL
    
    return result;
  });

/**
 * Get user with caching
 */
export const getUserWithCache = (userId: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient;
    const cacheKey = `user:${userId}`;
    
    const user = yield* cachedApiCall(
      cacheKey,
      http.get<User>(`/api/users/${userId}`)
    );
    
    return user;
  });

/**
 * Batch fetch users with parallelization
 */
export const batchFetchUsers = (userIds: string[]) =>
  Effect.gen(function* () {
    yield* Effect.log(`Fetching ${userIds.length} users in parallel`);
    
    const users = yield* Effect.forEach(userIds, (id) => getUserWithCache(id), {
      concurrency: 5,
    });
    
    yield* Effect.log(`Successfully fetched ${users.length} users`);
    
    return users;
  });

/**
 * Authenticated API call
 */
export const authenticatedCall = <A>(
  token: string,
  makeRequest: Effect.Effect<A, HttpError>
): Effect.Effect<A, HttpError | AuthError> =>
  Effect.gen(function* () {
    if (!token || token.length === 0) {
      const error: AuthError = { _tag: 'AuthError', reason: 'Missing authentication token' };
      return yield* Effect.fail(error);
    }
    
    // Simulate authenticated request
    yield* Effect.log('Making authenticated request');
    
    const result = yield* makeRequest.pipe(
      Effect.catchAll((error: HttpError | AuthError) =>
        error._tag === 'HttpError' && error.status === 401
          ? Effect.fail<AuthError>({ _tag: 'AuthError', reason: 'Authentication failed' })
          : Effect.fail(error)
      )
    );
    
    return result;
  });

/**
 * Database transaction with rollback
 */
export const dbTransaction = <A, E, R>(
  operations: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* Effect.log('Starting database transaction');
    
    const result = yield* operations.pipe(
      Effect.tap(() => Effect.log('Committing transaction')),
      Effect.catchAll((error: E) =>
        Effect.gen(function* () {
          yield* Effect.log('Rolling back transaction');
          return yield* Effect.fail(error);
        })
      )
    );
    
    return result;
  });

/**
 * Complex workflow: fetch, process, save
 */
export const processUserWorkflow = (userId: string) =>
  Effect.gen(function* () {
    // Step 1: Fetch user
    yield* Effect.log(`Starting workflow for user ${userId}`);
    const user = yield* getUserWithCache(userId);
    
    // Step 2: Validate
    if (!user.email.includes('@')) {
      const error: HttpError = {
        _tag: 'HttpError',
        status: 400,
        message: 'Invalid user email',
      };
      return yield* Effect.fail(error);
    }
    
    // Step 3: Process in parallel
    const [processedName, enrichedData] = yield* Effect.all([
      Effect.succeed(user.name.toUpperCase()),
      Effect.succeed({ metadata: 'additional info' }),
    ]);
    
    // Step 4: Save in transaction
    const result = yield* dbTransaction(
      Effect.gen(function* () {
        yield* Effect.log(`Saving processed user: ${processedName}`);
        return { ...user, name: processedName, ...enrichedData };
      })
    );
    
    yield* Effect.log('Workflow completed successfully');
    
    return result;
  });

/**
 * Circuit breaker pattern
 */
export interface CircuitOpenError {
  readonly _tag: 'CircuitOpenError';
  readonly message: string;
}

export const withCircuitBreaker = <A, E>(
  operation: Effect.Effect<A, E>,
  failureCount: Ref.Ref<number>
): Effect.Effect<A, E | CircuitOpenError> =>
  Effect.gen(function* () {
    const currentFailures = yield* Ref.get(failureCount);
    
    if (currentFailures > 5) {
      const error: CircuitOpenError = {
        _tag: 'CircuitOpenError',
        message: 'Circuit breaker is open',
      };
      return yield* Effect.fail(error);
    }
    
    const result = yield* operation.pipe(
      Effect.tap(() => Ref.set(failureCount, 0)),
      Effect.catchAll((error: E) =>
        Effect.gen(function* () {
          yield* Ref.update(failureCount, (n) => n + 1);
          return yield* Effect.fail(error);
        })
      )
    );
    
    return result;
  });

export const main = batchFetchUsers(['user-1', 'user-2', 'user-3']);
