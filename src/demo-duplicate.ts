import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as amqp from 'amqplib';
import { startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';
import {
  checkInvariants,
  countTasks,
  printKv,
  resetState,
  runMain,
  waitFor,
} from './messaging/demo-kit';
import { OrderPlacedEvent } from './messaging/events';
import { EventPublisher } from './messaging/publisher';

runMain(async () => {
  const pool = createPool();
  const conn = await amqp.connect(brokerUrl());
  try {
    await resetState(conn, pool);
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'demo-crash-consumer.js')],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
        env: process.env,
      },
    );
    let childOut = '';
    child.stdout.on('data', (d) => (childOut += d.toString()));
    const childExit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) =>
      child.on('exit', (code, signal) => resolve({ code, signal })),
    );
    await waitFor(
      () => childOut.includes('READY') || child.exitCode !== null,
      15_000,
      'child consumer READY',
    );
    if (!childOut.includes('READY'))
      throw new Error('child consumer failed to start');

    const event: OrderPlacedEvent = {
      eventId: crypto.randomUUID(),
      type: 'order.placed',
      occurredAt: new Date().toISOString(),
      data: {
        orderId: 'demo-dup-1',
        buyerId: '1',
        totalCents: 4200,
        items: [{ productId: '1', quantity: 2 }],
      },
    };
    const publisher = new EventPublisher(brokerUrl());
    await publisher.publish(event);
    await publisher.close();

    const exit = await Promise.race([
      childExit,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('child did not die in 15 s')), 15_000),
      ),
    ]);
    const childDeliveries = (childOut.match(/^EFFECT /gm) ?? []).length;
    const childApplied = /EFFECT applied=1/.test(childOut) ? 1 : 0;

    const ch = await conn.createChannel();
    const consumer = await startConsumer(ch, pool);
    await waitFor(() => consumer.stats.acked >= 1, 15_000, 'redelivery acked');

    const deliveries = childDeliveries + consumer.stats.delivered;
    const effect = childApplied + consumer.stats.applied;
    const skipped = consumer.stats.skipped;
    const inDb = await countTasks(pool, 'demo-dup-1');

    printKv({
      deliveries,
      effect,
      skipped,
      redelivered: consumer.stats.redelivered,
      'child-killed': exit.signal === 'SIGKILL' || exit.code !== 0 ? 1 : 0,
    });

    checkInvariants([
      [
        deliveries >= 2,
        `deliveries=${deliveries}, expected at least 2: the duplicate never happened, so the demo proves nothing`,
      ],
      [effect === 1, `effect=${effect}, expected 1`],
      [inDb === 1, `fulfillment_tasks rows=${inDb}, expected 1`],
      [skipped >= 1, `skipped=${skipped}, expected at least 1`],
      [
        consumer.stats.redelivered >= 1,
        `the broker did not mark the delivery as redelivered`,
      ],
    ]);
  } finally {
    await conn.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
});
