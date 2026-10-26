import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import { withRetry } from './retry';

// demo:retry - a deliberate read-modify-write in JS under REPEATABLE READ.
// N concurrent transactions read the balance, "think", then write
// balance + DELTA. Without retry the second and later ones fail with 40001
// ("could not serialize access due to concurrent update"); with the wrapper
// each one is repeated whole (with a fresh read), so no update is lost.

const TX_COUNT = 8;
const DELTA = 100;
const EMAIL = 'retry-demo@demo.marketplace.dev';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions({ extra: { max: TX_COUNT + 2 } }));
  await ds.initialize();
  try {
    const rows = await ds.query(
      `INSERT INTO users (email, password_hash, role, balance_cents)
       VALUES ($1, 'demo$hash', 'buyer', 0)
       ON CONFLICT (lower(email)) DO UPDATE SET balance_cents = 0
       RETURNING id`,
      [EMAIL],
    );
    const userId = String(rows[0].id);

    let retries = 0;
    const codes: Record<string, number> = {};

    await Promise.all(
      Array.from({ length: TX_COUNT }, (_, i) =>
        withRetry(
          ds,
          async (qr) => {
            // The read is part of the transaction and is repeated with it.
            const [{ balance_cents }] = await qr.query(`SELECT balance_cents FROM users WHERE id = $1`, [userId]);
            await sleep(30); // window in which other transactions read the same value
            await qr.query(`UPDATE users SET balance_cents = $2 WHERE id = $1`, [userId, balance_cents + DELTA]);
          },
          {
            isolation: 'REPEATABLE READ',
            maxAttempts: 20,
            label: `tx#${i + 1}`,
            onRetry: ({ code }) => {
              retries++;
              codes[code] = (codes[code] ?? 0) + 1;
            },
          },
        ),
      ),
    );

    const [{ balance_cents: finalBalance }] = await ds.query(`SELECT balance_cents FROM users WHERE id = $1`, [userId]);
    const expected = TX_COUNT * DELTA;

    console.log(`транзакцій: ${TX_COUNT}, дельта: +${DELTA}`);
    console.log(`повторів (retry): ${retries} ${JSON.stringify(codes)}`);
    console.log(`фінальний баланс: ${finalBalance}, очікувано: ${expected}`);

    const problems: string[] = [];
    if (retries < 1) problems.push('жодного 40001/40P01 не спіймано — сценарій не спровокував конфлікт');
    if (finalBalance !== expected) problems.push(`баланс ${finalBalance} ≠ ${expected} (втрачені апдейти)`);

    if (problems.length > 0) {
      console.error(`ПЕРЕВІРКА НЕ ПРОЙДЕНА:\n - ${problems.join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log('OK: стан арифметично коректний, lost update немає.');
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error('demo:retry впав:', err);
  process.exit(1);
});
