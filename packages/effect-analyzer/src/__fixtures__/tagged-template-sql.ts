import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

// Migration-style program using tagged template SQL
export const migration = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )`

  yield* sql`CREATE INDEX IF NOT EXISTS idx_users_name ON users(name)`

  const rows = yield* sql`SELECT * FROM users WHERE id = ${1}`
})
