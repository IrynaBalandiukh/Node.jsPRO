import { writeSync } from 'node:fs';
import * as amqp from 'amqplib';
import { RunningConsumer, startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';

function say(line: string): void {
  try {
    writeSync(1, `${line}\n`);
  } catch {}
}

(async () => {
  const pool = createPool(2);
  const conn = await amqp.connect(brokerUrl());
  const ch = await conn.createChannel();
  let consumer: RunningConsumer | undefined;
  consumer = await startConsumer(ch, pool, {
    afterEffect: () => {
      say(
        `EFFECT applied=${consumer?.stats.applied} redelivered=${consumer?.stats.redelivered}`,
      );
      process.kill(process.pid, 'SIGKILL');
    },
  });
  say('READY');
})().catch((err) => {
  console.error(`crash-consumer failed: ${(err as Error).message}`);
  process.exit(2);
});
