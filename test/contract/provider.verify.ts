import { VerifierOptions, Verifier } from '@pact-foundation/pact';
import { createTestApp } from '../integration/testkit/app';
import { startTestDb, TestDb } from '../integration/testkit/postgres';
import { PACTS_DIR, PROVIDER_NAME, PROVIDER_VERSION } from './pact.config';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Provider states сідять БД. Усе через INSERT ... ON CONFLICT DO NOTHING з
// фіксованими id, тож верифікація повторювана на непорожній базі.
async function seedUsers(db: TestDb) {
  await db.pool.query(`
    INSERT INTO users (id, email, password_hash, role) VALUES
      (1, 'pact-seller@example.test', 'x', 'seller'),
      (2, 'pact-buyer@example.test',  'x', 'buyer')
    ON CONFLICT DO NOTHING`);
}

async function seedProduct(db: TestDb) {
  await seedUsers(db);
  await db.pool.query(`
    INSERT INTO products (id, seller_id, name, description, price_cents, stock)
    VALUES (1, 1, 'Mechanical Keyboard', 'Hot-swappable 75% keyboard', 8999, 12)
    ON CONFLICT DO NOTHING`);
}

async function seedOrder(db: TestDb) {
  await seedProduct(db);
  await db.pool.query(`
    INSERT INTO orders (id, buyer_id, status, total_amount_cents) VALUES (1, 2, 'pending', 8999)
    ON CONFLICT DO NOTHING`);
  await db.pool.query(`
    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_cents)
    VALUES (1, 1, 1, 1, 8999)
    ON CONFLICT DO NOTHING`);
}

// Явні id не рухають послідовності: без цього наступний INSERT без id
// (замовлення від POST /orders) впав би на PK.
async function syncSequences(db: TestDb) {
  for (const table of ['users', 'products', 'orders', 'order_items']) {
    await db.pool.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
    );
  }
}

function pactSource(): Partial<VerifierOptions> {
  const brokerUrl = process.env.PACT_BROKER_URL;
  if (brokerUrl) {
    return {
      pactBrokerUrl: brokerUrl,
      // Токен — лише з оточення (сховище локально / secrets GitHub у CI); ключ
      // не передаємо взагалі, якщо токена нема (локальний брокер без авторизації).
      ...(process.env.PACT_BROKER_TOKEN ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN } : {}),
      consumerVersionSelectors: [{ latest: true }],
      publishVerificationResult: true,
      providerVersion: PROVIDER_VERSION,
    };
  }
  // Без брокера (локальний прогін / грейдер) — контракт з файлу, без публікації.
  const files = fs.readdirSync(PACTS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`No pact files in ${PACTS_DIR} — run npm run test:contract first`);
  return { pactUrls: files.map((f) => path.join(PACTS_DIR, f)) };
}

async function main() {
  const db = await startTestDb();
  const app = await createTestApp(db);
  let failed = false;

  try {
    await app.listen(0);
    const providerBaseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await new Verifier({
      provider: PROVIDER_NAME,
      providerBaseUrl,
      logLevel: 'info',
      stateHandlers: {
        'product 1 exists': async () => {
          await seedProduct(db);
          await syncSequences(db);
        },
        'order 1 exists': async () => {
          await seedOrder(db);
          await syncSequences(db);
        },
        'order 999999 does not exist': async () => {
          await db.pool.query('DELETE FROM orders WHERE id = 999999');
        },
      },
      ...pactSource(),
    }).verifyProvider();
  } catch (err) {
    failed = true;
    console.error('Provider verification failed:', err instanceof Error ? err.message : err);
  } finally {
    await app.close();
    await db.stop();
  }
  process.exit(failed ? 1 : 0);
}

void main();
