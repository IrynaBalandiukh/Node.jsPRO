import type { Channel, ConsumeMessage } from 'amqplib';
import type { Queryable } from '../repositories/queryable';
import { OrderPlacedEvent, orderPlacedSchema } from './events';
import { WORK_QUEUE } from './topology';

// ── Споживач (кроки 3, 4, 6) ──────────────────────────────────────────────

// Крок 4. Обґрунтування числа:  prefetch × час обробки < consumer_timeout.
// Обробка одного повідомлення — один INSERT у Postgres, ~5–10 мс. Стоковий
// consumer_timeout — 30 хв = 1 800 000 мс. 10 × 10 мс = 100 мс ≪ 1 800 000 мс.
// prefetch=1 тут був би гіршим: кожне повідомлення чекало б повного кола «ack → брокер → наступна
// доставка» (RTT), і споживач простоював би. 10 тримає конвеєр заповненим, але не дає
// першому споживачеві забрати всю чергу (дефолт 0 = без ліміту).
export const PREFETCH = 10;

export interface ConsumerStats {
  delivered: number; // скільки доставок отримали (включно з повторними)
  redelivered: number; // з них позначених брокером як redelivered
  applied: number; // ефект застосовано
  skipped: number; // відкинуто як дубль
  acked: number;
  rejected: number; // отруєні → DLQ
  requeued: number; // тимчасова помилка → повернуто в чергу
}

export interface ConsumerOptions {
  /** Хук після ефекту, але ДО ack: демо використовує його, щоб «впасти» саме в цій щілині. */
  afterEffect?: (event: OrderPlacedEvent) => void;
  /** Брокер сам скасував підписку (basic.cancel, наприклад consumer_timeout або видалена черга). */
  onCancel?: () => void;
}

export interface RunningConsumer {
  consumerTag: string;
  prefetch: number;
  stats: ConsumerStats;
}

/**
 * Ефект події order.placed: створити завдання на комплектацію.
 *
 * Ідемпотентність — властивість ОПЕРАЦІЇ, і ми її забезпечуємо формою запиту:
 * INSERT … ON CONFLICT DO NOTHING за природним ключем (event_id — PK, order_id — UNIQUE).
 * Повтор тієї самої події нічого не змінює, а `rowCount` каже, чи був ефект справжнім.
 * Порівняй з `UPDATE products SET qty = qty - 1`: такий повтор був би подвоєнням.
 * Сховище — Postgres, тож воно переживає рестарт споживача і є спільним для всіх реплік.
 */
export async function applyOrderPlaced(db: Queryable, event: OrderPlacedEvent): Promise<boolean> {
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
    const parsed = orderPlacedSchema.safeParse(JSON.parse(msg.content.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // не JSON
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

  // Крок 4: без цього рядка діє дефолт брокера (0 = без ліміту).
  await ch.prefetch(PREFETCH);

  const { consumerTag } = await ch.consume(
    WORK_QUEUE,
    async (msg) => {
      // Брокер надсилає null, коли скасовує підписку (basic.cancel). Наївне `if (!msg) return`
      // тут мовчки «жило б далі» без підписки: даємо знати зовні.
      if (msg === null) {
        options.onCancel?.();
        return;
      }
      stats.delivered++;
      if (msg.fields.redelivered) stats.redelivered++;

      // Отруєне повідомлення (не JSON / порушує контракт) не обробиться ніколи, скільки б
      // разів його не повторювали. Тож reject з requeue=false: брокер сам відправить його в DLX.
      const event = parseEvent(msg);
      if (!event) {
        ch.reject(msg, false);
        stats.rejected++;
        return;
      }

      try {
        // Крок 3: спочатку ЕФЕКТ …
        const applied = await applyOrderPlaced(db, event);
        if (applied) stats.applied++;
        else stats.skipped++;
        options.afterEffect?.(event);
        // … і лише потім ack. ack означає «я більше не вимагаю повтору».
        ch.ack(msg);
        stats.acked++;
      } catch {
        // Тимчасова помилка (БД недоступна): повертаємо в чергу. Саме reject, а не nack:
        // reject збільшує лічильник доставок, тож після x-delivery-limit повідомлення піде в DLQ
        // (delivery_limit), а не крутитиметься вічно.
        ch.reject(msg, true);
        stats.requeued++;
      }
    },
    { noAck: false },
  );

  return { consumerTag, prefetch: PREFETCH, stats };
}
