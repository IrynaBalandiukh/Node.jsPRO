import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NestExpressApplication } from '@nestjs/platform-express';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { UsersRepository } from '../../src/repositories/users.repository';
import { createTestApp } from '../integration/testkit/app';
import { aProduct, aSeller, aUser } from '../integration/testkit/builders';
import { startTestDb, TestDb } from '../integration/testkit/postgres';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the condition');
    await sleep(20);
  }
}

describe('Order status notifications (WebSocket gateway, E2E)', () => {
  let db: TestDb;
  let app: NestExpressApplication;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    app = await createTestApp(db);
    // IPv4 explicitly: "localhost" may resolve to ::1 on Windows.
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
  });
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.close());
  });

  async function connect(userId?: string): Promise<Socket> {
    const socket = io(url, {
      transports: ['websocket'],
      auth: userId ? { userId } : {},
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  const join = (socket: Socket, orderId: string) => socket.emitWithAck('join', { orderId });

  function collect(socket: Socket): unknown[] {
    const events: unknown[] = [];
    socket.on('order.status', (e) => events.push(e));
    return events;
  }

  async function placeOrder() {
    const seller = await new UsersRepository(db.pool).create(aSeller());
    const product = await new ProductsRepository(db.pool).create(aProduct(seller.id, { stock: 10 }));
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ items: [{ product_id: product.id, quantity: 1 }] })
      .expect(201);
    return res.body as { id: string; buyer_id: string };
  }

  const pay = (orderId: string) =>
    request(app.getHttpServer()).patch(`/orders/${orderId}/status`).send({ status: 'paid' }).expect(200);

  it('delivers the status change to the owner of the order', async () => {
    const order = await placeOrder();
    const client = await connect(order.buyer_id);
    const events = collect(client);
    expect(await join(client, order.id)).toEqual({ ok: true });

    await pay(order.id);

    await waitFor(() => events.length > 0);
    expect(events).toEqual([
      { order_id: order.id, status: 'paid', changed_at: expect.any(String) },
    ]);
  });

  it('refuses a user who does not own the order', async () => {
    const order = await placeOrder();
    const stranger = await new UsersRepository(db.pool).create(aUser());
    const client = await connect(stranger.id);
    const events = collect(client);

    expect(await join(client, order.id)).toEqual({ ok: false, error: 'forbidden' });
    await pay(order.id);

    await sleep(300);
    expect(events).toHaveLength(0);
  });

  it('refuses an anonymous client', async () => {
    const order = await placeOrder();
    const client = await connect();

    expect(await join(client, order.id)).toEqual({ ok: false, error: 'unauthorized' });
  });

  it('rejects a malformed order id', async () => {
    const order = await placeOrder();
    const client = await connect(order.buyer_id);

    expect(await join(client, 'not-a-number')).toEqual({ ok: false, error: 'bad_request' });
  });

  it('sends the event only to the room of that order', async () => {
    const orderA = await placeOrder();
    const orderB = await placeOrder();
    const clientA = await connect(orderA.buyer_id);
    const clientB = await connect(orderB.buyer_id);
    const eventsA = collect(clientA);
    const eventsB = collect(clientB);
    await join(clientA, orderA.id);
    await join(clientB, orderB.id);

    await pay(orderA.id);

    await waitFor(() => eventsA.length > 0);
    await sleep(300);
    expect(eventsA).toHaveLength(1);
    expect(eventsB).toHaveLength(0);
  });
});
