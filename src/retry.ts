import { DataSource, QueryRunner } from 'typeorm';

// Only two PostgreSQL codes mean "retry the whole transaction":
//  40001 serialization_failure - conflict under REPEATABLE READ/SERIALIZABLE;
//  40P01 deadlock_detected     - PG killed one participant of a deadlock.
// Anything else (23xxx constraint violations, 42xxx SQL errors, business
// errors) will not go away on retry; retrying only hides a bug or repeats
// side effects.
const RETRYABLE = new Set(['40001', '40P01']);

export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; driverError?: { code?: unknown } } | null;
  const code = e?.driverError?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
}

export interface RetryOptions {
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  maxAttempts?: number;
  baseDelayMs?: number;
  label?: string;
  onRetry?: (info: { attempt: number; code: string; delayMs: number }) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` in a transaction. On 40001/40P01 it rolls back, waits (exponential
 * backoff + jitter) and runs `fn` again FROM THE START, reads included:
 * retrying only the write on a stale read is the same lost update.
 */
export async function withRetry<T>(
  ds: DataSource,
  fn: (qr: QueryRunner) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { isolation = 'REPEATABLE READ', maxAttempts = 10, baseDelayMs = 10, label = 'tx' } = opts;

  for (let attempt = 1; ; attempt++) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction(isolation);
      const result = await fn(qr);
      await qr.commitTransaction();
      return result;
    } catch (err) {
      try {
        await qr.rollbackTransaction();
      } catch {
        // The connection may already be closed; the original error matters more.
      }
      const code = pgErrorCode(err);
      if (!code || !RETRYABLE.has(code) || attempt >= maxAttempts) throw err;

      const delayMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()));
      console.log(`[retry] ${label}: спроба ${attempt} впала з ${code}, повтор через ${delayMs}мс`);
      opts.onRetry?.({ attempt, code, delayMs });
      await sleep(delayMs);
    } finally {
      await qr.release();
    }
  }
}
