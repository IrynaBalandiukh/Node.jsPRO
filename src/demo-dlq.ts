import * as amqp from 'amqplib';
import { startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';
import { checkInvariants, depth, printKv, resetState, runMain, waitFor } from './messaging/demo-kit';
import { EventPublisher } from './messaging/publisher';
import { DLQ, WORK_QUEUE } from './messaging/topology';

// demo:dlq — отруєне повідомлення (не JSON) не обробиться ніколи. Споживач робить
// reject(requeue=false), брокер переносить його через DLX у DLQ, а причину ми
// читаємо із заголовків x-first-death-reason / x-death.

const REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'];

runMain(async () => {
  const pool = createPool();
  const conn = await amqp.connect(brokerUrl());
  try {
    await resetState(conn, pool);

    const consumerCh = await conn.createChannel();
    const consumer = await startConsumer(consumerCh, pool);

    const publisher = new EventPublisher(brokerUrl());
    await publisher.publishRaw(Buffer.from('{"type":"order.placed", this is not json'), crypto.randomUUID());
    await publisher.close();

    const ch = await conn.createChannel();
    await waitFor(async () => (await depth(ch, DLQ)) === 1, 15_000, 'message in DLQ');

    // Читаємо причину. get з ack-режимом + закриття каналу = повідомлення лишається в DLQ
    // (непідтверджене повертається в чергу), тож dlq=1 і в кінці демо.
    const reader = await conn.createChannel();
    const got = await reader.get(DLQ, { noAck: false });
    if (!got) throw new Error('DLQ reported depth 1, but basic.get returned nothing');
    const headers = got.properties.headers ?? {};
    const death = (headers['x-death'] as Array<{ reason: string }> | undefined)?.[0];
    const reason = String(headers['x-first-death-reason'] ?? death?.reason ?? 'unknown');
    await reader.close();

    await waitFor(async () => (await depth(ch, DLQ)) === 1, 5_000, 'message back in DLQ after the read');
    const work = await depth(ch, WORK_QUEUE);
    const dlq = await depth(ch, DLQ);

    printKv({
      rejected: consumer.stats.rejected,
      work,
      dlq,
      'dlq-reason': reason,
      effect: consumer.stats.applied,
    });

    checkInvariants([
      [work === 0, `work=${work}, expected 0`],
      [dlq === 1, `dlq=${dlq}, expected 1`],
      [REASONS.includes(reason), `dlq-reason=${reason} is not one of ${REASONS.join('|')}`],
      [consumer.stats.applied === 0, `effect=${consumer.stats.applied}, a poisoned message must not apply an effect`],
    ]);
  } finally {
    await conn.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
});
