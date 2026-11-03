import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitSchema1790089957055 } from '../../../src/migrations/1790089957055-InitSchema';
import { ConcurrencyLayer1790200000000 } from '../../../src/migrations/1790200000000-ConcurrencyLayer';
import { OrderLifecycleStatuses1790300000000 } from '../../../src/migrations/1790300000000-OrderLifecycleStatuses';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  /** Isolation between tests: empty tables, id counters from 1. */
  reset(): Promise<void>;
  /** Sets the env from which AppModule builds the connection to this container. */
  applyAppEnv(): void;
  stop(): Promise<void>;
}

// The container is already "ready" per the log, but the forwarded port on Docker Desktop
// sometimes still resets the first connections (ECONNRESET) — wait until SELECT 1 passes.
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

// Docker Desktop occasionally returns 409 "container is not running" right during
// startup (the container is still initializing) — retry the start instead of failing the whole file.
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
 * Starts a real Postgres 16 in Docker and applies the application's REAL
 * migrations (the same as in prod), not a separate test DDL.
 * DATABASE_URL is issued by the container at runtime — no secret store here.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await startContainer();

  // localhost on Docker Desktop (Windows) may resolve to ::1, where the port forwarding
  // resets connections (ECONNRESET) — use IPv4.
  const uri = container.getConnectionUri().replace('@localhost:', '@127.0.0.1:');

  await waitForPostgres(uri);

  const ds = new DataSource({
    type: 'postgres',
    url: uri,
    migrations: [
      InitSchema1790089957055,
      ConcurrencyLayer1790200000000,
      OrderLifecycleStatuses1790300000000,
    ],
    synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();

  const pool = new Pool({ connectionString: uri });
  pool.on('error', () => {}); // a dropped idle connection when the container stops must not crash the process
  let passwordFile: string | undefined;

  return {
    container,
    pool,
    reset: async () => {
      await pool.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
    },
    applyAppEnv: () => {
      // DatabaseService reads the password from a file (rotation without restart, HW 11).
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
