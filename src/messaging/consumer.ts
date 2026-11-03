import type { Channel, ConsumeMessage } from 'amqplib';
import type { Queryable } from '../repositories/queryable';
import { OrderPlacedEvent, orderPlacedSchema } from './events';
import { WORK_QUEUE } from './topology';

export const PREFETCH = 10;

export interface ConsumerStats {
  delivered: number;
  redelivered: number;
  applied: number;
  skipped: number;
  acked: number;
  rejected: number;
  requeued: number;
}

export interface ConsumerOptions {
  afterEffect?: (event: OrderPlacedEvent) => void;
  onCancel?: () => void;
}

export interface RunningConsumer {
  consumerTag: string;
  prefetch: number;
  stats: ConsumerStats;
}

export async function applyOrderPlaced(
  db: Queryable,
  event: OrderPlacedEvent,
): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO fulfillment_tasks (event_id, order_id, total_cents)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [event.eventId, event.data.orderId, event.data.totalCents],
  );
  return res.rowCount === 1;
}

function parseEvent(msg: ConsumeMessage): OrderPlacedEvent | null {
  try {
    const parsed = orderPlacedSchema.safeParse(
      JSON.parse(msg.content.toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function startConsumer(
  ch: Channel,
  db: Queryable,
  options: ConsumerOptions = {},
): Promise<RunningConsumer> {
  const stats: ConsumerStats = {
    delivered: 0,
    redelivered: 0,
    applied: 0,
    skipped: 0,
    acked: 0,
    rejected: 0,
    requeued: 0,
  };

  await ch.prefetch(PREFETCH);

  const { consumerTag } = await ch.consume(
    WORK_QUEUE,
    async (msg) => {
      if (msg === null) {
        options.onCancel?.();
        return;
      }
      stats.delivered++;
      if (msg.fields.redelivered) stats.redelivered++;

      const event = parseEvent(msg);
      if (!event) {
        ch.reject(msg, false);
        stats.rejected++;
        return;
      }

      try {
        const applied = await applyOrderPlaced(db, event);
        if (applied) stats.applied++;
        else stats.skipped++;
        options.afterEffect?.(event);
        ch.ack(msg);
        stats.acked++;
      } catch {
        ch.reject(msg, true);
        stats.requeued++;
      }
    },
    { noAck: false },
  );

  return { consumerTag, prefetch: PREFETCH, stats };
}
