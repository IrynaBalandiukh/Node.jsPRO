import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitSchema1790089957055 } from '../../../src/migrations/1790089957055-InitSchema';
import { ConcurrencyLayer1790200000000 } from '../../../src/migrations/1790200000000-ConcurrencyLayer';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  /** Ізоляція між тестами: порожні таблиці, лічильники id з 1. */
  reset(): Promise<void>;
  /** Виставляє env, з якого AppModule збирає підключення до цього контейнера. */
  applyAppEnv(): void;
  stop(): Promise<void>;
}

// Контейнер уже «ready» за логом, але проброшений порт на Docker Desktop
// інколи ще рве перші з'єднання (ECONNRESET) — чекаємо, поки SELECT 1 пройде.
async function waitForPostgres(uri: string, attempts = 40): Promise<void> {
  for (let i = 1; ; i++) {
    const client = new Client({ connectionString: uri });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('SELECT 1');
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      await client.end().catch(() => {});
    }
  }
}

// Docker Desktop зрідка віддає 409 «container is not running» просто під час
// старту (контейнер ще ініціалізується) — повторюємо старт, а не валимо весь файл.
async function startContainer(attempts = 3): Promise<StartedPostgreSqlContainer> {
  for (let i = 1; ; i++) {
    try {
      return await new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('marketplace_test')
        .withUsername('marketplace_test')
        .withPassword('marketplace_test_pw')
        .start();
    } catch (err) {
      if (i >= attempts) throw err;
    }
  }
}

const TABLES = 'order_items, orders, products, users, jobs';

/**
 * Піднімає справжній Postgres 16 у Docker і накочує РЕАЛЬНІ міграції
 * застосунку (ті самі, що в проді), а не окремий тестовий DDL.
 * DATABASE_URL видає контейнер у рантаймі — жодного сховища секретів тут нема.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await startContainer();

  // localhost на Docker Desktop (Windows) може резолвитись у ::1, де проброс порту
  // рве зʼєднання (ECONNRESET) — ходимо за IPv4.
  const uri = container.getConnectionUri().replace('@localhost:', '@127.0.0.1:');

  await waitForPostgres(uri);

  const ds = new DataSource({
    type: 'postgres',
    url: uri,
    migrations: [InitSchema1790089957055, ConcurrencyLayer1790200000000],
    synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();

  const pool = new Pool({ connectionString: uri });
  pool.on('error', () => {}); // обрив idle-з'єднання при зупинці контейнера не має валити процес
  let passwordFile: string | undefined;

  return {
    container,
    pool,
    reset: async () => {
      await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    },
    applyAppEnv: () => {
      // DatabaseService читає пароль з файлу (ротація без рестарту, ДЗ №11).
      passwordFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-')), 'db_password');
      fs.writeFileSync(passwordFile, container.getPassword());
      Object.assign(process.env, {
        NODE_ENV: 'test',
        DB_HOST: container.getHost() === 'localhost' ? '127.0.0.1' : container.getHost(),
        DB_PORT: String(container.getPort()),
        DB_NAME: container.getDatabase(),
        DB_USER: container.getUsername(),
        DB_PASSWORD_FILE: passwordFile,
        DATABASE_URL: uri,
      });
    },
    stop: async () => {
      await pool.end();
      await container.stop();
      if (passwordFile) fs.rmSync(path.dirname(passwordFile), { recursive: true, force: true });
    },
  };
}
