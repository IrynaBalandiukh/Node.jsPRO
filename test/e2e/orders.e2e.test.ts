import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { UsersRepository } from '../../src/repositories/users.repository';
import { createTestApp } from '../integration/testkit/app';
import { aProduct, aSeller } from '../integration/testkit/builders';
import { startTestDb, TestDb } from '../integration/testkit/postgres';

describe('Marketplace API (E2E: full AppModule + real Postgres)', () => {
  let db: TestDb;
  let app: NestExpressApplication;

  beforeAll(async () => {
    db = await startTestDb();
    app = await createTestApp(db);
  });
  afterAll(async () => {
    await app.close();
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
  });

  it('happy path: create an order, then read it back', async () => {
    const seller = await new UsersRepository(db.pool).create(aSeller());
    const products = new ProductsRepository(db.pool);
    const keyboard = await products.create(aProduct(seller.id, { priceCents: 8999 }));
    const mouse = await products.create(aProduct(seller.id, { priceCents: 2500 }));

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [
          { product_id: keyboard.id, quantity: 1 },
          { product_id: mouse.id, quantity: 2 },
        ],
      })
      .expect(201);

    expect(created.body).toMatchObject({ status: 'pending', total_cents: 8999 + 2 * 2500 });
    expect(created.body.items).toHaveLength(2);

    const fetched = await request(app.getHttpServer()).get(`/orders/${created.body.id}`).expect(200);
    expect(fetched.body).toEqual(created.body);

    const list = await request(app.getHttpServer()).get('/orders').expect(200);
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([created.body.id]);
    expect(list.body.next_cursor).toBeNull();
  });

  it('returns 404 problem+json for an order that does not exist', async () => {
    const res = await request(app.getHttpServer()).get('/orders/999999').expect(404);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, title: 'Not Found' });
  });

  it('returns 400 for an invalid body (rejected by OpenAPI validation)', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [] })
      .expect(400);

    expect(res.body.status).toBe(400);
  });

  it('returns 404 when an order references a product that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ product_id: '424242', quantity: 1 }] })
      .expect(404);
  });
  describe('stock check', () => {
    const stockOf = async (id: string) => (await new ProductsRepository(db.pool).findById(id))!.stock;
    const order = (items: Array<{ product_id: string; quantity: number }>) =>
      request(app.getHttpServer()).post('/orders').set('Idempotency-Key', randomUUID()).send({ items });

    it('decrements stock when the order is created', async () => {
      const seller = await new UsersRepository(db.pool).create(aSeller());
      const p = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock: 5 }));

      await order([{ product_id: p.id, quantity: 2 }]).expect(201);

      expect(await stockOf(p.id)).toBe(3);
    });

    it('returns 409 problem+json when stock is not enough and creates nothing', async () => {
      const seller = await new UsersRepository(db.pool).create(aSeller());
      const p = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock: 2 }));

      const res = await order([{ product_id: p.id, quantity: 3 }]).expect(409);

      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body).toMatchObject({ status: 409, title: 'Conflict' });
      expect(await stockOf(p.id)).toBe(2);
      const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM orders');
      expect(rows[0].n).toBe(0);
    });

    it('rolls back earlier items when a later item is out of stock', async () => {
      const seller = await new UsersRepository(db.pool).create(aSeller());
      const products = new ProductsRepository(db.pool);
      const plenty = await products.create(aProduct(seller.id, { stock: 10 }));
      const scarce = await products.create(aProduct(seller.id, { stock: 1 }));

      await order([
        { product_id: plenty.id, quantity: 4 },
        { product_id: scarce.id, quantity: 2 },
      ]).expect(409);

      expect(await stockOf(plenty.id)).toBe(10);
      expect(await stockOf(scarce.id)).toBe(1);
    });

    it('never oversells under concurrent orders', async () => {
      const seller = await new UsersRepository(db.pool).create(aSeller());
      const p = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock: 3 }));

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => order([{ product_id: p.id, quantity: 1 }])),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(await stockOf(p.id)).toBe(0);
    });
  });
  describe('status change', () => {
    async function placeOrder(stock = 5, quantity = 2) {
      const seller = await new UsersRepository(db.pool).create(aSeller());
      const product = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock }));
      const res = await request(app.getHttpServer())
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ items: [{ product_id: product.id, quantity }] })
        .expect(201);
      return { product, order: res.body };
    }
    const patch = (id: string, status: string) =>
      request(app.getHttpServer()).patch(`/orders/${id}/status`).send({ status });
    const stockOf = async (id: string) => (await new ProductsRepository(db.pool).findById(id))!.stock;

    it('moves a pending order to paid', async () => {
      const { order } = await placeOrder();

      const res = await patch(order.id, 'paid').expect(200);

      expect(res.body).toMatchObject({ id: order.id, status: 'paid' });
    });

    it('returns the reserved stock when an order is cancelled', async () => {
      const { product, order } = await placeOrder(5, 2);
      expect(await stockOf(product.id)).toBe(3);

      await patch(order.id, 'cancelled').expect(200);

      expect(await stockOf(product.id)).toBe(5);
    });

    it('walks the whole life cycle pending -> paid -> processing -> shipped -> delivered', async () => {
      const { order } = await placeOrder();

      for (const status of ['paid', 'processing', 'shipped', 'delivered']) {
        const res = await patch(order.id, status).expect(200);
        expect(res.body.status).toBe(status);
      }
    });

    it('can cancel a paid order and returns its stock once', async () => {
      const { product, order } = await placeOrder(5, 2);
      await patch(order.id, 'paid').expect(200);

      await patch(order.id, 'cancelled').expect(200);

      expect(await stockOf(product.id)).toBe(5);
    });

    it('returns 409 invalid-status-transition for a change the life cycle forbids', async () => {
      const { order } = await placeOrder();

      const skip = await patch(order.id, 'shipped').expect(409); // pending -> shipped
      expect(skip.body.type).toMatch(/invalid-status-transition$/);

      await patch(order.id, 'cancelled').expect(200);
      await patch(order.id, 'paid').expect(409); // cancelled is final
    });

    it('does not restock a second time and cannot cancel after shipping', async () => {
      const { product, order } = await placeOrder(5, 2);
      await patch(order.id, 'cancelled').expect(200);
      await patch(order.id, 'cancelled').expect(409);
      expect(await stockOf(product.id)).toBe(5);

      const shipped = await placeOrder(5, 2);
      for (const status of ['paid', 'processing', 'shipped']) {
        await patch(shipped.order.id, status).expect(200);
      }
      await patch(shipped.order.id, 'cancelled').expect(409);
      expect(await stockOf(shipped.product.id)).toBe(3);
    });

    it('returns 404 for an order that does not exist', async () => {
      await patch('999999', 'paid').expect(404);
    });

    it('returns 400 for a status outside the allowed values', async () => {
      const { order } = await placeOrder();
      await patch(order.id, 'pending').expect(400);
    });
  });
});
