import { PG_FOREIGN_KEY_VIOLATION } from '../../src/repositories/queryable';
import { OrdersRepository } from '../../src/repositories/orders.repository';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { UsersRepository } from '../../src/repositories/users.repository';
import { aProduct, aSeller, aUser } from './testkit/builders';
import { startTestDb, TestDb } from './testkit/postgres';

describe('OrdersRepository (real Postgres)', () => {
  let db: TestDb;
  let orders: OrdersRepository;
  let products: ProductsRepository;
  let users: UsersRepository;
  let sellerId: string;
  let buyerId: string;

  beforeAll(async () => {
    db = await startTestDb();
    orders = new OrdersRepository(db.pool);
    products = new ProductsRepository(db.pool);
    users = new UsersRepository(db.pool);
  });
  afterAll(async () => {
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
    sellerId = (await users.create(aSeller())).id;
    buyerId = (await users.create(aUser())).id;
  });

  it('creates an order with items and computes the total in SQL (JOIN + SUM)', async () => {
    const keyboard = await products.create(aProduct(sellerId, { priceCents: 8999 }));
    const mouse = await products.create(aProduct(sellerId, { priceCents: 2500 }));

    const order = await orders.create(buyerId, [
      { productId: keyboard.id, quantity: 1 },
      { productId: mouse.id, quantity: 2 },
    ]);

    expect(order.status).toBe('pending');
    expect(order.total_cents).toBe(8999 + 2 * 2500);
    expect(order.items).toEqual([
      { product_id: keyboard.id, quantity: 1, unit_price_cents: 8999 },
      { product_id: mouse.id, quantity: 2, unit_price_cents: 2500 },
    ]);
    expect(await orders.findById(order.id)).toEqual(order);
  });

  it('snapshots the unit price: a later price change does not rewrite history', async () => {
    const p = await products.create(aProduct(sellerId, { priceCents: 1000 }));
    const order = await orders.create(buyerId, [{ productId: p.id, quantity: 1 }]);

    await db.pool.query('UPDATE products SET price_cents = 5000 WHERE id = $1', [p.id]);

    expect((await orders.findById(order.id))!.items[0].unit_price_cents).toBe(1000);
  });

  it('rejects an order for a buyer that does not exist (foreign key, 23503)', async () => {
    const p = await products.create(aProduct(sellerId));

    await expect(orders.create('424242', [{ productId: p.id, quantity: 1 }])).rejects.toMatchObject({
      code: PG_FOREIGN_KEY_VIOLATION,
    });
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(0); // одноатомний CTE: нічого не залишилось
  });

  it('aggregates totals per buyer (GROUP BY), ignoring cancelled orders', async () => {
    const otherBuyerId = (await users.create(aUser())).id;
    const p = await products.create(aProduct(sellerId, { priceCents: 1000 }));
    await orders.create(buyerId, [{ productId: p.id, quantity: 1 }]);
    await orders.create(buyerId, [{ productId: p.id, quantity: 3 }]);
    const cancelled = await orders.create(otherBuyerId, [{ productId: p.id, quantity: 9 }]);
    await db.pool.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [cancelled.id]);

    expect(await orders.totalsByBuyer()).toEqual([{ buyerId, orders: 2, totalCents: 4000 }]);
  });

  it('deleting an order cascades to its items, but a product in use cannot be deleted', async () => {
    const p = await products.create(aProduct(sellerId));
    const order = await orders.create(buyerId, [{ productId: p.id, quantity: 1 }]);

    await expect(db.pool.query('DELETE FROM products WHERE id = $1', [p.id])).rejects.toMatchObject({
      code: PG_FOREIGN_KEY_VIOLATION, // ON DELETE RESTRICT
    });

    await db.pool.query('DELETE FROM orders WHERE id = $1', [order.id]);
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM order_items');
    expect(rows[0].n).toBe(0); // ON DELETE CASCADE
  });
});
