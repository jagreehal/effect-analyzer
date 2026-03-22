/**
 * Effect Schema patterns for testing static analysis
 * 
 * This fixture tests:
 * - Schema definitions
 * - Schema validation and parsing
 * - Schema transformations
 * - Schema compositions (structs, unions, optionals)
 */

import { Schema } from 'effect';
import { Effect } from 'effect';

// =============================================================================
// Basic Schema Definitions
// =============================================================================

/**
 * Simple string schema with email validation
 */
export const EmailSchema = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
  Schema.brand('Email')
);

/**
 * Positive integer schema
 */
export const PositiveInt = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand('PositiveInt')
);

/**
 * User ID as branded string
 */
export const UserId = Schema.String.pipe(Schema.brand('UserId'));

// =============================================================================
// Struct Schemas
// =============================================================================

/**
 * Address schema
 */
export const AddressSchema = Schema.Struct({
  street: Schema.String,
  city: Schema.String,
  country: Schema.String,
  postalCode: Schema.String,
});

/**
 * User schema with nested address
 */
export const UserSchema = Schema.Struct({
  id: UserId,
  email: EmailSchema,
  name: Schema.String,
  age: Schema.optional(PositiveInt),
  address: Schema.optional(AddressSchema),
  tags: Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] }),
});

/**
 * CreateUserRequest schema for API input
 */
export const CreateUserRequest = Schema.Struct({
  email: EmailSchema,
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100)),
  age: Schema.optional(PositiveInt),
});

// =============================================================================
// Union and Tagged Schemas
// =============================================================================

/**
 * Status as a literal union
 */
export const StatusSchema = Schema.Literal('pending', 'active', 'inactive');

/**
 * Discriminated union for API responses
 */
export const ApiResponse = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal('success'),
    data: Schema.Unknown,
  }),
  Schema.Struct({
    _tag: Schema.Literal('error'),
    error: Schema.String,
    code: Schema.Number,
  })
);

/**
 * Tagged error for domain errors using plain struct
 */
export const ValidationError = Schema.Struct({
  _tag: Schema.Literal('ValidationError'),
  field: Schema.String,
  message: Schema.String,
});

/**
 * Tagged request for API operations - using simple struct approach
 */
export const GetUserRequest = Schema.Struct({
  _tag: Schema.Literal('GetUserRequest'),
  userId: UserId,
});

// =============================================================================
// Schema Transformations
// =============================================================================

/**
 * Schema with encode/decode transformation using Schema.transform
 */
export const DateFromString = Schema.transform(Schema.String, Schema.DateFromSelf, {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});

/**
 * Trimmed string schema
 */
export const TrimmedString = Schema.String.pipe(Schema.trimmed());

// =============================================================================
// Programs Using Schemas
// =============================================================================

/**
 * Program that validates user input
 */
export const validateUserProgram = (input: unknown) =>
  Effect.gen(function* () {
    const user = yield* Schema.decodeUnknown(CreateUserRequest)(input);
    return user;
  }).pipe(
    Effect.catchTag('ParseError', (error) =>
      Effect.fail({ _tag: 'ValidationError' as const, message: String(error) })
    )
  );

/**
 * Program that encodes data
 */
export const encodeUserProgram = (user: Schema.Schema.Type<typeof UserSchema>) =>
  Effect.gen(function* () {
    const encoded = yield* Schema.encode(UserSchema)(user);
    return encoded;
  });

/**
 * Program with schema composition
 */
export const processApiResponseProgram = (response: unknown) =>
  Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(ApiResponse)(response);
    
    if (parsed._tag === 'success') {
      return parsed.data;
    } else {
      return yield* Effect.fail(new Error(parsed.error));
    }
  });

/**
 * Program with branded types
 */
export const createUserIdProgram = (id: string) =>
  Effect.gen(function* () {
    const validated = yield* Schema.decode(UserId)(id);
    return validated;
  });

export const main = validateUserProgram({ email: 'test@example.com', name: 'Test' });
