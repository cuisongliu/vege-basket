import 'dotenv/config'
import pg from 'pg'
import type { QueryResultRow } from 'pg'
import { registerDatabasePoolErrorHandler } from './database-pool-policy.ts'

const { Pool } = pg

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

export const pool = new Pool({
  connectionString: databaseUrl,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
})

registerDatabasePoolErrorHandler(pool)

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return pool.query<T>(text, params)
}
