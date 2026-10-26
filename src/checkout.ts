import { DataSource, QueryRunner } from 'typeorm';

export interface CheckoutItem {
  productId: string;
  quantity: number;
}

export interface CheckoutResult {
  orderId: string;
  totalCents: number;
}

// Business errors: the whole transaction is rolled back, no orphan orders.
export class OutOfStockError extends Error {
  constructor(public readonly productId: string) {
    super(`Not enough stock for product ${productId}`);
  }
}

export class InsufficientFundsError extends Error {
  constructor(public readonly buyerId: string) {
    super(`Insufficient balance for buyer ${buyerId}`);
  }
}

// Structured result, so UPDATE ... RETURNING and SELECT both yield plain rows.
async function run(qr: QueryRunner, sql: string, params: unknown[]): Promise<Record<string, any>[]> {
  const res = await qr.query(sql, params, true);
  return res.records ?? [];
}

// One transaction on one connection (queryRunner). Stock and balance are
// decremented by atomic `UPDATE ... WHERE stock >= $n RETURNING`: 0 rows means
// "not enough", and the row lock closes the race window. Items are locked in
// productId order, so concurrent multi-item orders cannot deadlock.
export async function checkout(
  ds: DataSource,
  buyerId: string,
  items: CheckoutItem[],
): Promise<CheckoutResult> {
  if (items.length === 0) throw new Error('Empty order');
  const sorted = [...items].sort((a, b) => {
    const x = BigInt(a.productId);
    const y = BigInt(b.productId);
    return x < y ? -1 : x > y ? 1 : 0;
  });

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
      `INSERT INTO orders (buyer_id, status, total_cents)
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
    return { orderId, totalCents: total };
  } catch (err) {
    // Roll back, but never let a rollback failure hide the original error.
    await qr.rollbackTransaction().catch(() => undefined);
    throw err;
  } finally {
    await qr.release();
  }
}
