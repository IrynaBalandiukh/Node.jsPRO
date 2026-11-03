import * as amqp from 'amqplib';
import { startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';
import {
  checkInvariants,
  countTasks,
  depth,
  printKv,
  resetState,
  runMain,
  sleep,
  waitFor,
} from './messaging/demo-kit';
import { OrderPlacedEvent } from './messaging/events';
import { EventPublisher } from './messaging/publisher';
import { DLQ, WORK_QUEUE } from './messaging/topology';

const EVENTS = 5;

runMain(async () => {
  const pool = createPool();
  const conn = await amqp.connect(brokerUrl());
  try {
    await resetState(conn, pool);

    const consumerCh = await conn.createChannel();
    const consumer = await startConsumer(consumerCh, pool);

    const publisher = new EventPublisher(brokerUrl());
    for (let i = 1; i <= EVENTS; i++) {
      const event: OrderPlacedEvent = {
        eventId: crypto.randomUUID(),
        type: 'order.placed',
        occurredAt: new Date().toISOString(),
        data: {
          orderId: `demo-publish-${i}`,
          buyerId: '1',
          totalCents: 1000 * i,
          items: [{ productId: '1', quantity: i }],
        },
      };
      await publisher.publish(event);
    }
    await publisher.close();

    await waitFor(
      () => consumer.stats.acked >= EVENTS,
      15_000,
      `${EVENTS} acks`,
    );
    await sleep(300);

    const ch = await conn.createChannel();
    const work = await depth(ch, WORK_QUEUE);
    const dlq = await depth(ch, DLQ);
    const inDb = await countTasks(pool, 'demo-publish-%');
    const { stats } = consumer;

    printKv({
      published: EVENTS,
      delivered: stats.delivered,
      effect: stats.applied,
      acked: stats.acked,
      dlq,
      work,
      prefetch: consumer.prefetch,
    });

    checkInvariants([
      [
        stats.delivered === EVENTS,
        `delivered=${stats.delivered}, expected ${EVENTS}`,
      ],
      [stats.applied === EVENTS, `effect=${stats.applied}, expected ${EVENTS}`],
      [inDb === EVENTS, `fulfillment_tasks rows=${inDb}, expected ${EVENTS}`],
      [stats.acked === EVENTS, `acked=${stats.acked}, expected ${EVENTS}`],
      [dlq === 0, `dlq=${dlq}, expected 0`],
      [work === 0, `work=${work}, expected 0`],
      [
        consumer.prefetch >= 1 && consumer.prefetch <= 2000,
        `prefetch=${consumer.prefetch} out of 1..2000`,
      ],
    ]);
  } finally {
    await conn.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
});
