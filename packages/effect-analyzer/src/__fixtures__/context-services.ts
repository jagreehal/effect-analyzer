/**
 * Effect patterns using Context, Services, and Tags
 * 
 * This fixture tests the static analyzer's ability to detect:
 * - Context.Tag definitions
 * - Service dependencies
 * - Effect.gen with service access via yield*
 * - Layer composition
 */

import { Context, Effect, Layer } from 'effect';

// =============================================================================
// Service Definitions using Context.Tag
// =============================================================================

/**
 * Database service with query operations
 */
export class Database extends Context.Tag('Database')<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<unknown[], DatabaseError>;
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E | DatabaseError, R>;
  }
>() {}

/**
 * Configuration service
 */
export class Config extends Context.Tag('Config')<
  Config,
  {
    readonly get: <A>(key: string) => Effect.Effect<A, ConfigError>;
    readonly getOrDefault: <A>(key: string, defaultValue: A) => Effect.Effect<A>;
  }
>() {}

/**
 * Logger service
 */
export class Logger extends Context.Tag('Logger')<
  Logger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
    readonly error: (message: string, error: unknown) => Effect.Effect<void>;
    readonly debug: (message: string) => Effect.Effect<void>;
  }
>() {}

// =============================================================================
// Error Types - Plain objects with _tag for discriminated unions
// =============================================================================

export interface DatabaseError {
  readonly _tag: 'DatabaseError';
  readonly message: string;
  readonly code: string;
}

export interface ConfigError {
  readonly _tag: 'ConfigError';
  readonly key: string;
  readonly reason: string;
}

// =============================================================================
// Programs Using Services
// =============================================================================

/**
 * Simple program that uses multiple services via Effect.gen
 */
export const serviceProgram = Effect.gen(function* () {
  const logger = yield* Logger;
  const config = yield* Config;
  
  yield* logger.info('Starting service program');
  
  const dbUrl = yield* config.getOrDefault('DATABASE_URL', 'localhost');
  yield* logger.debug(`Database URL: ${dbUrl}`);
  
  return dbUrl;
});

/**
 * Program that uses Database service
 */
export const databaseProgram = Effect.gen(function* () {
  const db = yield* Database;
  const logger = yield* Logger;
  
  yield* logger.info('Executing database query');
  
  const results = yield* db.query('SELECT * FROM users');
  
  yield* logger.info(`Found ${results.length} users`);
  
  return results;
});

/**
 * Program with nested service usage and error handling
 */
export const nestedServiceProgram = Effect.gen(function* () {
  const logger = yield* Logger;
  const db = yield* Database;
  
  yield* logger.info('Starting nested operation');
  
  const result = yield* db.transaction(
    Effect.gen(function* () {
      yield* logger.info('Inside transaction');
      const users = yield* db.query('SELECT * FROM users');
      return users.length;
    })
  );
  
  yield* logger.info(`Transaction completed with result: ${result}`);
  
  return result;
}).pipe(
  Effect.catchTag('DatabaseError' as const, (error: DatabaseError) =>
    Effect.gen(function* () {
      const logger = yield* Logger;
      yield* logger.error('Database operation failed', error);
      return 0;
    })
  )
);

// =============================================================================
// Layer Definitions
// =============================================================================

/**
 * Live implementation of Logger service
 */
export const LoggerLive = Layer.succeed(Logger, {
  info: (message) => Effect.log(`[INFO] ${message}`),
  error: (message, error) => Effect.log(`[ERROR] ${message}: ${String(error)}`),
  debug: (message) => Effect.log(`[DEBUG] ${message}`),
});

/**
 * Effectful layer for Config service
 */
export const ConfigLive = Layer.effect(
  Config,
  Effect.gen(function* () {
    const configMap = new Map<string, unknown>();
    
    return {
      get: <A>(key: string) =>
        Effect.gen(function* () {
          const value = configMap.get(key);
          if (value === undefined) {
            const error: ConfigError = { _tag: 'ConfigError', key, reason: 'Not found' };
            return yield* Effect.fail(error);
          }
          return value as A;
        }),
      getOrDefault: <A>(key: string, defaultValue: A) =>
        Effect.succeed((configMap.get(key) ?? defaultValue) as A),
    };
  })
);

/**
 * Database layer that depends on Config
 */
export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* Config;
    const dbUrl = yield* config.getOrDefault('DATABASE_URL', 'localhost');
    
    return {
      query: (sql: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`Executing: ${sql} on ${dbUrl}`);
          return [];
        }),
      transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          yield* Effect.log('Starting transaction');
          const result = yield* effect;
          yield* Effect.log('Committing transaction');
          return result;
        }),
    };
  })
).pipe(Layer.provide(ConfigLive));

/**
 * Merged layer providing all services
 */
export const AppLayer = Layer.mergeAll(LoggerLive, ConfigLive, DatabaseLive);

// =============================================================================
// Programs with Layer Provision
// =============================================================================

/**
 * Program with inline layer provision
 */
export const programWithLayer = databaseProgram.pipe(
  Effect.provide(LoggerLive)
);

/**
 * Program using provide with merged layers
 */
export const programWithMergedLayers = nestedServiceProgram.pipe(
  Effect.provide(AppLayer)
);

/**
 * Program with fresh layer (non-shared)
 */
export const programWithFreshLayer = Effect.gen(function* () {
  const logger = yield* Logger;
  yield* logger.info('Using fresh layer');
  return 'done';
}).pipe(
  Effect.provide(Layer.fresh(LoggerLive))
);

export const main = serviceProgram;
