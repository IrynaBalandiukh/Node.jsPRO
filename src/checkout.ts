import { DataSource, QueryRunner } from 'typeorm';

export interface CheckoutItem {
  productId: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: string;
  totalAmountCents: number;
}

// Бізнес-помилки: транзакція відкочується цілком, замовлення-«сироти» не
// лишається.
export class OutOfStockError extends Error {
  constructor(public readonly productId: string) {
    super(`Недостатньо товару ${productId} на складі`);
  }
}

export class InsufficientFundsError extends Error {
  constructor(public readonly buyerId: string) {
    super(`Недостатньо коштів у покупця ${buyerId}`);
  }
}

// Один запит із structured result: TypeORM для UPDATE ... RETURNING інакше
// повертає [rows, count], для SELECT — просто rows; records уніфікує.
async function run(qr: QueryRunner, sql: string, params: unknown[]): Promise<Record<string, any>[]> {
  const res = await qr.query(sql, params, true);
  return res.records ?? [];
}

/**
 * Оформлення замовлення в ОДНІЙ транзакції на ОДНОМУ з'єднанні (queryRunner):
 *  1. для кожної позиції — атомарний `UPDATE products SET stock = stock - $n
 *     WHERE id = $1 AND stock >= $n RETURNING price_cents`; 0 рядків = нема
 *     товару (і перевірка, і рядковий лок — вікна для гонки немає);
 *  2. списання балансу — так само атомарним UPDATE ... WHERE balance >= total;
 *  3. INSERT orders + order_items;
 *  4. INSERT задачі post-processing у чергу (виконується воркером окремо).
 * Позиції сортуються за productId — однаковий порядок локів у всіх
 * транзакцій виключає deadlock між замовленнями з кількома товарами.
 */
export async function checkout(
  ds: DataSource,
  buyerId: string,
  items: CheckoutItem[],
): Promise<CheckoutResult> {
  if (items.length === 0) throw new Error('Порожнє замовлення');
  const sorted = [...items].sort((a, b) => (BigInt(a.productId) < BigInt(b.productId) ? -1 : 1));

  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    const priced: Array<CheckoutItem & { unitPriceCents: number }> = [];
    let total = 0;

    for (const it of sorted) {
      const rows = await run(
        qr,
        `UPDATE products SET stock = stock - $2
          WHERE id = $1 AND stock >= $2 AND is_active
        RETURNING price_cents`,
        [it.productId, it.quantity],
      );
      if (rows.length === 0) throw new OutOfStockError(it.productId);
      const unitPriceCents = rows[0].price_cents as number;
      priced.push({ ...it, unitPriceCents });
      total += unitPriceCents * it.quantity;
    }

    const paid = await run(
      qr,
      `UPDATE users SET balance_cents = balance_cents - $2
        WHERE id = $1 AND balance_cents >= $2
      RETURNING id`,
      [buyerId, total],
    );
    if (paid.length === 0) throw new InsufficientFundsError(buyerId);

    const [order] = await run(
      qr,
      `INSERT INTO orders (buyer_id, status, total_amount_cents)
       VALUES ($1, 'paid', $2) RETURNING id`,
      [buyerId, total],
    );
    const orderId = String(order.id);

    for (const it of priced) {
      await run(
        qr,
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.productId, it.quantity, it.unitPriceCents],
      );
    }

    await run(
      qr,
      `INSERT INTO jobs (kind, payload) VALUES ('post_process', $1::jsonb)`,
      [JSON.stringify({ orderId, buyerId })],
    );

    await qr.commitTransaction();
    return { orderId, totalAmountCents: total };
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}
