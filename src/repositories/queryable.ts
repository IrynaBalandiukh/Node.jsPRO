import type { QueryResult, QueryResultRow } from 'pg';

// Усе, що вміє виконати SQL: pg.Pool, pg.PoolClient, pg.Client. Репозиторії
// приймають саме це, тож тест може підсунути клієнта всередині транзакції.
export interface Queryable {
  query<R extends QueryResultRow = any>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

// SQLSTATE кодів, які Postgres віддає на порушення обмежень.
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

export function pgErrorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
}

// bigint-ідентифікатор приходить з URL/тіла як рядок: перед підстановкою в
// `$1::bigint` перевіряємо форму, щоб кривий id давав 404, а не 500.
export function isBigintId(value: string): boolean {
  return /^\d{1,18}$/.test(value);
}
