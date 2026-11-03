import type { Channel } from 'amqplib';

export const EVENTS_EXCHANGE = 'shop.events';
export const ORDER_PLACED_KEY = 'order.placed';
export const WORK_QUEUE = 'orders.placed';

export const DLX_EXCHANGE = 'shop.dlx';
export const DLQ = 'orders.placed.dlq';

export const UNROUTABLE_EXCHANGE = 'shop.unroutable';
export const UNROUTABLE_QUEUE = 'shop.unroutable';

export const DELIVERY_LIMIT = 5;

export async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(UNROUTABLE_EXCHANGE, 'fanout', { durable: true });
  await ch.assertQueue(UNROUTABLE_QUEUE, { durable: true });
  await ch.bindQueue(UNROUTABLE_QUEUE, UNROUTABLE_EXCHANGE, '');

  await ch.assertExchange(EVENTS_EXCHANGE, 'topic', {
    durable: true,
    arguments: { 'alternate-exchange': UNROUTABLE_EXCHANGE },
  });

  await ch.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
  await ch.assertQueue(DLQ, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await ch.bindQueue(DLQ, DLX_EXCHANGE, ORDER_PLACED_KEY);

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
