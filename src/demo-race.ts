import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import { checkout, InsufficientFundsError, OutOfStockError } from './checkout';

// demo:race — 50 паралельних checkout на один товар зі stock = 10, по одній
// одиниці. Promise.all, жодних черг у застосунку: кожен виклик бере власне
// з'єднання з пулу. Скрипт сам перевіряє інваріанти й виходить із кодом 1,
// якщо стався oversell.

const ATTEMPTS = 50;
const INITIAL_STOCK = 10;
const BUYERS = 5;
const RICH_BALANCE_CENTS = 1_000_000_000; // свідомо надлишковий: обмежує лише stock
const PRICE_CENTS = 12_345;

async function scalar<T>(ds: DataSource, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await ds.query(sql, params);
  return rows[0].v as T;
}

async function upsertUser(ds: DataSource, email: string, role: string, balance: number): Promise<string> {
  const rows = await ds.query(
    `INSERT INTO users (email, password_hash, role, balance_cents)
     VALUES ($1, 'demo$hash', $2, $3)
     ON CONFLICT (email) DO UPDATE SET balance_cents = EXCLUDED.balance_cents
     RETURNING id`,
    [email, role, balance],
  );
  return String(rows[0].id);
}

async function main(): Promise<void> {
  // 60 > 50: усі виклики справді отримують з'єднання одночасно.
  const ds = new DataSource(buildDataSourceOptions({ extra: { max: ATTEMPTS + 10 } }));
  await ds.initialize();
  try {
    // --- фікстури (ідемпотентні: повторний запуск скидає стан демо) ---
    const sellerId = await upsertUser(ds, 'race-seller@demo.marketplace.dev', 'seller', 0);
    const buyerIds: string[] = [];
    for (let i = 1; i <= BUYERS; i++) {
      buyerIds.push(await upsertUser(ds, `race-buyer${i}@demo.marketplace.dev`, 'buyer', RICH_BALANCE_CENTS));
    }
    await ds.query(
      `DELETE FROM jobs WHERE kind = 'post_process' AND (payload->>'buyerId')::bigint = ANY($1::bigint[])`,
      [buyerIds],
    );
    await ds.query(`DELETE FROM orders WHERE buyer_id = ANY($1::bigint[])`, [buyerIds]); // order_items — CASCADE
    const existing = await ds.query(`SELECT id FROM products WHERE name = 'Race Demo Item'`);
    let productId: string;
    if (existing.length > 0) {
      productId = String(existing[0].id);
      await ds.query(`UPDATE products SET stock = $2, price_cents = $3, is_active = true WHERE id = $1`, [
        productId,
        INITIAL_STOCK,
        PRICE_CENTS,
      ]);
    } else {
      const r = await ds.query(
        `INSERT INTO products (seller_id, name, description, price_cents, stock)
         VALUES ($1, 'Race Demo Item', 'Товар для demo:race', $2, $3) RETURNING id`,
        [sellerId, PRICE_CENTS, INITIAL_STOCK],
      );
      productId = String(r[0].id);
    }

    // --- шквал ---
    const started = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: ATTEMPTS }, (_, i) =>
        checkout(ds, buyerIds[i % BUYERS], [{ productId, quantity: 1 }]),
      ),
    );
    const elapsed = Date.now() - started;

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const outOfStock = rejected.filter((r) => r.reason instanceof OutOfStockError).length;
    const noFunds = rejected.filter((r) => r.reason instanceof InsufficientFundsError).length;
    const unexpected = rejected.filter(
      (r) => !(r.reason instanceof OutOfStockError) && !(r.reason instanceof InsufficientFundsError),
    );

    // --- перевірка інваріантів у БД ---
    const finalStock = await scalar<number>(ds, `SELECT stock AS v FROM products WHERE id = $1`, [productId]);
    const negativeRows = await scalar<number>(ds, `SELECT count(*)::int AS v FROM products WHERE stock < 0`);
    const orders = await scalar<number>(
      ds,
      `SELECT count(*)::int AS v FROM order_items WHERE product_id = $1`,
      [productId],
    );
    const jobs = await scalar<number>(
      ds,
      `SELECT count(*)::int AS v FROM jobs WHERE kind = 'post_process' AND (payload->>'buyerId')::bigint = ANY($1::bigint[])`,
      [buyerIds],
    );
    const debited = Number(
      await scalar<string>(
        ds,
        `SELECT ($1::bigint * $2::bigint - sum(balance_cents))::bigint AS v FROM users WHERE id = ANY($3::bigint[])`,
        [BUYERS, RICH_BALANCE_CENTS, buyerIds],
      ),
    );

    console.log(`спроб:                       ${ATTEMPTS}`);
    console.log(`успішних:                    ${succeeded}`);
    console.log(`відмов (немає товару):       ${outOfStock}`);
    console.log(`відмов (немає коштів):       ${noFunds}`);
    console.log(`неочікуваних помилок:        ${unexpected.length}`);
    console.log(`фінальний stock:             ${finalStock}`);
    console.log(`рядків із відʼємним stock:   ${negativeRows}`);
    console.log(`замовлень (order_items):     ${orders}`);
    console.log(`задач post_process:          ${jobs}`);
    console.log(`списано з балансів (коп.):   ${debited} (очікувано ${succeeded * PRICE_CENTS})`);
    console.log(`час:                         ${elapsed} мс`);

    const problems: string[] = [];
    if (unexpected.length > 0) problems.push(`неочікувані помилки: ${unexpected.map((r) => String(r.reason)).join('; ')}`);
    if (succeeded !== INITIAL_STOCK) problems.push(`успішних ${succeeded}, очікувалось ${INITIAL_STOCK}`);
    if (Number(finalStock) !== 0) problems.push(`фінальний stock ${finalStock}, очікувався 0`);
    if (Number(negativeRows) !== 0) problems.push(`рядків із відʼємним stock: ${negativeRows}`);
    if (Number(orders) !== succeeded) problems.push(`замовлень ${orders} ≠ успішних ${succeeded} (сироти/втрати)`);
    if (Number(jobs) !== succeeded) problems.push(`задач ${jobs} ≠ успішних ${succeeded}`);
    if (debited !== succeeded * PRICE_CENTS) problems.push(`списано ${debited}, очікувалось ${succeeded * PRICE_CENTS}`);

    if (problems.length > 0) {
      console.error(`ІНВАРІАНТ ПОРУШЕНО:\n - ${problems.join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log('OK: oversell немає, інваріанти виконані.');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('demo:race впав:', err);
  process.exit(1);
});
