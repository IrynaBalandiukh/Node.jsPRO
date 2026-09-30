import { DataSource } from 'typeorm';

export type JobHandler = (job: { id: string; kind: string; payload: Record<string, unknown> }) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Один воркер. Цикл: у транзакції беремо ОДНУ вільну задачу
 * `FOR UPDATE SKIP LOCKED` (рядки, які тримають інші воркери, пропускаються,
 * а не блокують), обробляємо, і в тій самій транзакції ставимо status='done',
 * processed = processed + 1. Якщо воркер упав до COMMIT — лок зникає разом
 * із транзакцією, і задачу підбере інший.
 *
 * Порожній результат SKIP LOCKED означає лише «вільних зараз нема». Тому
 * перед виходом перепитуємо, чи лишились pending-рядки (вони можуть бути
 * залочені іншими воркерами і повернутись у чергу, якщо той впаде).
 */
export async function runWorker(
  ds: DataSource,
  workerId: string,
  handler: JobHandler,
  kind?: string,
): Promise<number> {
  let handled = 0;
  const kindFilter = kind ? 'AND kind = $1' : '';
  const params = kind ? [kind] : [];

  for (;;) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    try {
      await qr.startTransaction();
      const res = await qr.query(
        `SELECT id, kind, payload FROM jobs
          WHERE status = 'pending' ${kindFilter}
          ORDER BY id
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        params,
        true,
      );
      const job = res.records[0];

      if (!job) {
        await qr.commitTransaction();
        const left = await qr.query(
          `SELECT count(*)::int AS n FROM jobs WHERE status = 'pending' ${kindFilter}`,
          params,
          true,
        );
        if (left.records[0].n === 0) return handled;
        await sleep(20); // pending є, але їх тримають інші воркери — чекаємо
        continue;
      }

      await handler({ id: String(job.id), kind: job.kind, payload: job.payload });
      await qr.query(
        `UPDATE jobs
            SET status = 'done', processed = processed + 1,
                worker_id = $2, processed_at = now()
          WHERE id = $1`,
        [job.id, workerId],
      );
      await qr.commitTransaction();
      handled++;
    } catch (err) {
      await qr.rollbackTransaction().catch(() => undefined);
      throw err;
    } finally {
      await qr.release();
    }
  }
}

// Імітація post-processing (лист/чек): задача триває `ms` мілісекунд.
export const simulatedHandler =
  (ms: number): JobHandler =>
  async () => {
    await sleep(ms);
  };
