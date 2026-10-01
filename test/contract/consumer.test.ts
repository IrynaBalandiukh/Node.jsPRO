import * as fs from 'node:fs';
import * as path from 'node:path';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { MarketplaceClient } from './frontend-client';
import { CONSUMER_NAME, PACTS_DIR, PROVIDER_NAME } from './pact.config';

const { like, regex, integer, eachLike, string } = MatchersV3;

// Форми відповідей відповідають openapi/openapi.yaml (ДЗ №9):
// Product, Order, Problem. Значення — через матчери, щоб контракт не
// ламався від кожного нового запису.
const productShape = {
  id: regex(/^\d+$/, '1'),
  name: string('Mechanical Keyboard'),
  description: string('Hot-swappable 75% keyboard'),
  price_cents: integer(8999),
  stock: integer(12),
};

const orderShape = {
  id: regex(/^\d+$/, '1'),
  status: regex(/^(pending|paid|cancelled)$/, 'pending'),
  items: eachLike({
    product_id: regex(/^\d+$/, '1'),
    quantity: integer(1),
    unit_price_cents: integer(8999),
  }),
  total_cents: integer(8999),
  created_at: regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, '2026-01-01T10:00:00.000Z'),
};

const problemShape = (status: number, title: string) => ({
  type: like('about:blank'),
  title: like(title),
  status: like(status),
  detail: string('was not found'),
  instance: string('/orders/999999'),
});

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const PROBLEM_HEADERS = { 'Content-Type': 'application/problem+json; charset=utf-8' };

describe('marketplace-web ⇄ marketplace-api (consumer contract)', () => {
  // Pact дописує interactions у наявний файл — чистимо, щоб у контракті не
  // лишалось застарілих interactions з минулих прогонів.
  beforeAll(() => {
    fs.rmSync(path.join(PACTS_DIR, `${CONSUMER_NAME}-${PROVIDER_NAME}.json`), { force: true });
  });

  const pact = new PactV3({
    consumer: CONSUMER_NAME,
    provider: PROVIDER_NAME,
    dir: PACTS_DIR,
    logLevel: 'warn',
  });

  it('GET /products/{productId} returns a product', async () => {
    pact
      .given('product 1 exists')
      .uponReceiving('a request for product 1')
      .withRequest({ method: 'GET', path: '/products/1' })
      .willRespondWith({
        status: 200,
        headers: JSON_HEADERS,
        body: productShape,
      });

    await pact.executeTest(async (mock) => {
      const res = await new MarketplaceClient(mock.url).getProduct('1');
      expect(res.status).toBe(200);
      expect(res.body.price_cents).toBe(8999);
    });
  });

  it('GET /orders/{orderId} returns an order with its items', async () => {
    pact
      .given('order 1 exists')
      .uponReceiving('a request for order 1')
      .withRequest({ method: 'GET', path: '/orders/1' })
      .willRespondWith({
        status: 200,
        headers: JSON_HEADERS,
        body: orderShape,
      });

    await pact.executeTest(async (mock) => {
      const res = await new MarketplaceClient(mock.url).getOrder('1');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  it('GET /orders/{orderId} returns 404 problem+json when the order does not exist', async () => {
    pact
      .given('order 999999 does not exist')
      .uponReceiving('a request for a missing order')
      .withRequest({ method: 'GET', path: '/orders/999999' })
      .willRespondWith({
        status: 404,
        headers: PROBLEM_HEADERS,
        body: problemShape(404, 'Not Found'),
      });

    await pact.executeTest(async (mock) => {
      const res = await new MarketplaceClient(mock.url).getOrder('999999');
      expect(res.status).toBe(404);
    });
  });

  it('POST /orders creates an order (Idempotency-Key required)', async () => {
    pact
      .given('product 1 exists')
      .uponReceiving('a request to create an order for product 1')
      .withRequest({
        method: 'POST',
        path: '/orders',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'contract-test-key-1',
        },
        body: { items: [{ product_id: '1', quantity: 2 }] },
      })
      .willRespondWith({
        status: 201,
        headers: JSON_HEADERS,
        body: { ...orderShape, status: 'pending' },
      });

    await pact.executeTest(async (mock) => {
      const res = await new MarketplaceClient(mock.url).createOrder('contract-test-key-1', [
        { product_id: '1', quantity: 2 },
      ]);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
    });
  });
});
