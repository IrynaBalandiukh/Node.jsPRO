import { randomUUID } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OrderEventsService } from '../../src/orders/order-events.service';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { UsersRepository } from '../../src/repositories/users.repository';
import { createTestApp } from '../integration/testkit/app';
import { aProduct, aSeller } from '../integration/testkit/builders';
import { startTestDb, TestDb } from '../integration/testkit/postgres';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await sleep(20);
  }
}

interface Stream {
  headers: http.IncomingHttpHeaders;
  text: () => string;
  ids: () => string[];
  close: () => void;
}

describe('Order status notifications (SSE, E2E)', () => {
  let db: TestDb;
  let app: NestExpressApplication;
  let port: number;
  const streams: Stream[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    app = await createTestApp(db);
    await app.listen(0, '127.0.0.1'); // IPv4 explicitly: "localhost" may resolve to ::1 on Windows
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => {
    await app.close();
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
    // db.reset() restarts order ids at 1, so events buffered by an earlier test would leak in.
    (app.get(OrderEventsService) as unknown as { buffer: Map<string, unknown> }).buffer.clear();
  });
  afterEach(() => {
    streams.splice(0).forEach((s) => s.close());
  });

  function openStream(orderId: string, headers: Record<string, string> = {}): Promise<Stream> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port, path: `/orders/${orderId}/events`, headers },
        (res) => {
          res.setEncoding('utf8');
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          const stream: Stream = {
            headers: res.headers,
            text: () => data,
            ids: () => [...data.matchAll(/^id: (\d+)$/gm)].map((m) => m[1]),
            close: () => req.destroy(),
          };
          streams.push(stream);
          resolve(stream);
        },
      );
      req.on('error', reject);
    });
  }

  async function placeOrder(): Promise<string> {
    const seller = await new UsersRepository(db.pool).create(aSeller());
    const product = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock: 10 }));
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ product_id: product.id, quantity: 1 }] })
      .expect(201);
    return res.body.id;
  }

  it('answers with content-type text/event-stream', async () => {
    const orderId = await placeOrder();

    const stream = await openStream(orderId);

    expect(stream.headers['content-type']).toMatch(/^text\/event-stream/);
  });

  it('sends a status change as id / event / data lines', async () => {
    const orderId = await placeOrder();
    const stream = await openStream(orderId);

    await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).send({ status: 'paid' }).expect(200);

    await waitFor(() => stream.text().includes('data:'));
    expect(stream.text()).toContain('id: 1\n');
    expect(stream.text()).toContain('event: order.status\n');
    const data = JSON.parse(/^data: (.+)$/m.exec(stream.text())![1]);
    expect(data).toEqual({ order_id: orderId, status: 'paid', changed_at: expect.any(String) });
  });

  it('after Last-Event-ID replays only the missed events, without duplicates', async () => {
    const orderId = await placeOrder();
    for (const status of ['paid', 'processing', 'shipped', 'delivered']) {
      await request(app.getHttpServer()).patch(`/orders/${orderId}/status`).send({ status }).expect(200);
    }

    const resumed = await openStream(orderId, { 'Last-Event-ID': '3' });
    const fresh = await openStream(orderId);

    await waitFor(() => resumed.ids().length > 0 && fresh.ids().length >= 4);
    await sleep(200);
    expect(resumed.ids()).toEqual(['4']);
    expect(fresh.ids()).toEqual(['1', '2', '3', '4']);
  });

  it('delivers an event published after the replay exactly once', async () => {
    const orderId = await placeOrder();
    const events = app.get(OrderEventsService);
    events.publish({ orderId, status: 'paid', changedAt: new Date().toISOString() });
    const stream = await openStream(orderId, { 'Last-Event-ID': '1' });

    events.publish({ orderId, status: 'cancelled', changedAt: new Date().toISOString() });

    await waitFor(() => stream.ids().length > 0);
    await sleep(200);
    expect(stream.ids()).toEqual(['2']);
  });

  it('returns 404 problem+json for an order that does not exist', async () => {
    const res = await request(app.getHttpServer()).get('/orders/999999/events').expect(404);

    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
  });
});
