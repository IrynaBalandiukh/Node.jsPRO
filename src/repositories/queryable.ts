import type { QueryResult, QueryResultRow } from 'pg';

// Anything that can run SQL: pg.Pool, pg.PoolClient, pg.Client. Repositories
// accept exactly this, so a test can pass a client inside a transaction.
export interface Queryable {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

// SQLSTATE codes Postgres returns on constraint violations.
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export function pgErrorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
}

// A bigint identifier arrives from the URL/body as a string: before substituting into
// `$1::bigint` we check its shape, so a malformed id gives 404, not 500.
export function isBigintId(value: string): boolean {
  return /^\d{1,18}$/.test(value);
}
