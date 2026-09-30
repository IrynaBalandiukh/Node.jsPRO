import { DataSource, QueryRunner } from 'typeorm';

// Лише два коди PostgreSQL означають «повтори транзакцію цілком»:
//  40001 serialization_failure — конфлікт під REPEATABLE READ/SERIALIZABLE;
//  40P01 deadlock_detected     — PG сам убив одного з учасників дедлока.
// Усе інше (23xxx порушення constraint, 42xxx синтаксис, бізнес-помилки)
// від повтору не зникне — повтор лише сховає баг або помножить побічні ефекти.
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
 * Виконує `fn` у транзакції; на 40001/40P01 відкочує, чекає (експоненційний
 * backoff + jitter) і запускає `fn` знову З ПОЧАТКУ — разом із читаннями,
 * бо повтор самого запису на застарілому читанні — той самий lost update.
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
        // з'єднання могло вже закритись — оригінальна помилка важливіша
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
