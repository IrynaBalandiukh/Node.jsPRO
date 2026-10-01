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
});
