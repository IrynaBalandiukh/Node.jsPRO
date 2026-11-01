import * as amqp from 'amqplib';
import type { Pool } from 'pg';
import { assertTopology, DLQ, UNROUTABLE_QUEUE, WORK_QUEUE } from './topology';

// Спільні шматки трьох демо: чистий стан, очікування, вивід ключ=значення, перевірка інваріантів.

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`timeout (${timeoutMs} ms) waiting for: ${what}`);
    await sleep(50);
  }
}

/** Глибина черги (готові до доставки повідомлення, без unacked). */
export async function depth(ch: amqp.Channel, queue: string): Promise<number> {
  return (await ch.checkQueue(queue)).messageCount;
}

/**
 * Крок 1 кожного демо: привести стан до чистого. Топологія оголошується (ідемпотентно),
 * черги очищаються, демо-рядки ефекту видаляються. Чергу НЕ видаляємо: purge не міняє
 * аргументи, тож 406 inequivalent arg не з'являється.
 */
export async function resetState(conn: amqp.ChannelModel, pool: Pool): Promise<void> {
  const ch = await conn.createChannel();
  await assertTopology(ch);
  for (const q of [WORK_QUEUE, DLQ, UNROUTABLE_QUEUE]) await ch.purgeQueue(q);
  await ch.close();
  await pool.query(`DELETE FROM fulfillment_tasks WHERE order_id LIKE 'demo-%'`);
}

export function printKv(values: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(values)) console.log(`${k}=${v}`);
}

/** Крок 3 кожного демо: інваріант порушено → код ≠ 0. */
export function checkInvariants(checks: Array<[ok: boolean, description: string]>): never {
  const failed = checks.filter(([ok]) => !ok).map(([, d]) => d);
  if (failed.length === 0) {
    console.log('# invariants hold');
    process.exit(0);
  }
  for (const d of failed) console.error(`INVARIANT VIOLATED: ${d}`);
  process.exit(1);
}

export async function countTasks(pool: Pool, orderIdLike: string): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM fulfillment_tasks WHERE order_id LIKE $1`, [orderIdLike]);
  return rows[0].n;
}

export function runMain(main: () => Promise<void>): void {
  main().catch((err) => {
    console.error(`demo failed: ${(err as Error).message}`);
    process.exit(1);
  });
}
