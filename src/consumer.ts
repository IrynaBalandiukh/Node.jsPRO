import * as amqp from 'amqplib';
import { startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';
import { assertTopology } from './messaging/topology';

(async () => {
  const pool = createPool();
  const conn = await amqp.connect(brokerUrl());
  const ch = await conn.createChannel();
  await assertTopology(ch);

  const consumer = await startConsumer(ch, pool, {
    onCancel: () => {
      console.error('broker cancelled the consumer (basic.cancel), exiting');
      process.exit(1);
    },
  });
  console.log(`consumer started: prefetch=${consumer.prefetch}`);

  conn.on('close', () => {
    console.error('connection closed, exiting');
    process.exit(1);
  });
  const shutdown = async () => {
    await ch.cancel(consumer.consumerTag).catch(() => undefined);
    await conn.close().catch(() => undefined);
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error(`consumer failed: ${(err as Error).message}`);
  process.exit(1);
});
