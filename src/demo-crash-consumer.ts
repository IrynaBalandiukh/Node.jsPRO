import { writeSync } from 'node:fs';
import * as amqp from 'amqplib';
import { RunningConsumer, startConsumer } from './messaging/consumer';
import { brokerUrl, createPool } from './messaging/db';

// Дочірній процес для demo:duplicate. Застосовує ефект, а потім помирає
// через SIGKILL ДО ack: ОС закриває сокет, брокер бачить обрив і повертає повідомлення
// в чергу. Це справжнє падіння, на відміну від channel.close() (коректного завершення).
// Рядки у stdout пишемо синхронно (writeSync): процес зникне раніше, ніж спорожніє буфер.

function say(line: string): void {
  try {
    writeSync(1, `${line}\n`);
  } catch {
    /* батько все одно побачить код завершення */
  }
}

(async () => {
  const pool = createPool(2);
  const conn = await amqp.connect(brokerUrl());
  const ch = await conn.createChannel();
  let consumer: RunningConsumer | undefined;
  consumer = await startConsumer(ch, pool, {
    afterEffect: () => {
      say(`EFFECT applied=${consumer?.stats.applied} redelivered=${consumer?.stats.redelivered}`);
      process.kill(process.pid, 'SIGKILL'); // ефект є, ack-а немає
    },
  });
  say('READY');
})().catch((err) => {
  console.error(`crash-consumer failed: ${(err as Error).message}`);
  process.exit(2);
});
