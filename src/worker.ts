import { DataSource } from 'typeorm';

export type JobHandler = (job: { id: string; kind: string; payload: Record<string, unknown> }) => Promise<void>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One worker loop. In a transaction it takes ONE free job with
 * `FOR UPDATE SKIP LOCKED` (rows locked by other workers are skipped, not
 * waited for), handles it, and in the same transaction sets status = 'done'
 * and processed = processed + 1. If the worker dies before COMMIT, the lock
 * disappears with the transaction and another worker picks the job up.
 *
 * An empty SKIP LOCKED result only means "nothing free right now", so before
 * exiting the worker re-counts pending rows (other workers may still hold them).
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
        await sleep(20); // pending rows exist but are held by other workers: wait
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

// Simulated post-processing (email/receipt): a job takes `ms` milliseconds.
export const simulatedHandler =
  (ms: number): JobHandler =>
  async () => {
    await sleep(ms);
  };
