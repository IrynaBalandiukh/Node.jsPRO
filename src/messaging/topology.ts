import type { Channel } from 'amqplib';

// ── Топологія (крок 1) ────────────────────────────────────────────────────
// Її оголошує споживач / бутстрап (assertTopology), а НЕ продюсер: продюсер не
// повинен знати, хто його слухає. Оголошення ідемпотентне, якщо аргументи збігаються
// з уже існуючими (інакше 406 PRECONDITION_FAILED: аргументи черги незмінні).
//
//   producer ──► shop.events (topic) ──binding "order.placed"──► orders.placed (quorum, робоча)
//                    │                                              │ reject(requeue=false) /
//                    │ alternate-exchange                           │ delivery-limit
//                    ▼                                              ▼
//               shop.unroutable (fanout)                        shop.dlx (direct) ──► orders.placed.dlq
//                    └─► shop.unroutable (черга)

export const EVENTS_EXCHANGE = 'shop.events';
export const ORDER_PLACED_KEY = 'order.placed';
export const WORK_QUEUE = 'orders.placed';

export const DLX_EXCHANGE = 'shop.dlx';
export const DLQ = 'orders.placed.dlq';

export const UNROUTABLE_EXCHANGE = 'shop.unroutable';
export const UNROUTABLE_QUEUE = 'shop.unroutable';

// Скільки разів брокер повертає повідомлення споживачеві, перш ніж віддати в DLX
// (причина delivery_limit). Лише для quorum-черг.
export const DELIVERY_LIMIT = 5;

export async function assertTopology(ch: Channel): Promise<void> {
  // Alternate exchange: що не знайшло жодного binding, не зникає мовчки, а лягає сюди.
  await ch.assertExchange(UNROUTABLE_EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(UNROUTABLE_QUEUE, { durable: true });
  await ch.bindQueue(UNROUTABLE_QUEUE, UNROUTABLE_EXCHANGE, '');

  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', {
    durable: true,
    arguments: { 'alternate-exchange': UNROUTABLE_EXCHANGE },
  });

  // DLX-контур: окремий exchange + черга під нього.
  await ch.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(DLQ, DLX_EXCHANGE, ORDER_PLACED_KEY);

  // Робоча черга. quorum: працює delivery-limit і дані переживають рестарт брокера.
  await ch.assertQueue(WORK_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DLX_EXCHANGE,
      'x-dead-letter-routing-key': ORDER_PLACED_KEY,
      'x-delivery-limit': DELIVERY_LIMIT,
    },
  });
  await ch.bindQueue(WORK_QUEUE, EVENTS_EXCHANGE, ORDER_PLACED_KEY);
}
