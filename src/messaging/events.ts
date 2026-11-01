import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Order } from '../common/types';

// ── Контракт події (крок 2) ───────────────────────────────────────────────
// Свідомо спроектований DTO, а не ORM-сутність через spread: схему можна
// версіонувати, а колонки таблиці не стають публічним API.
// eventId стабільний: його генерує продюсер ОДИН раз при створенні події, і саме за ним
// споживач впізнає дубль.

export const orderPlacedSchema = z.object({
  eventId: z.string().uuid(),
  type: z.literal('order.placed'),
  occurredAt: z.string().datetime(),
  data: z.object({
    orderId: z.string().min(1),
    buyerId: z.string().min(1),
    totalCents: z.number().int().nonnegative(),
    items: z
      .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }))
      .min(1),
  }),
});

export type OrderPlacedEvent = z.infer<typeof orderPlacedSchema>;

export function buildOrderPlacedEvent(order: Order): OrderPlacedEvent {
  return {
    eventId: randomUUID(),
    type: 'order.placed',
    occurredAt: new Date().toISOString(),
    data: {
      orderId: order.id,
      buyerId: order.buyer_id,
      totalCents: order.total_cents,
      items: order.items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
    },
  };
}
