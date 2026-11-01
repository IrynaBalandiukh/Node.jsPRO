import { Pool } from 'pg';

/** Пул Postgres для консюмера й демо; підключення — ті самі змінні, що й у data-source.ts. */
export function createPool(max = 5): Pool {
  const url = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (url) return new Pool({ connectionString: url, max });
  return new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max,
  });
}

export function brokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url) {
    console.error('BROKER_URL is not set (comes from the secret store via scripts/with-secrets.sh, or export it with SKIP_VAULT=1)');
    process.exit(1);
  }
  return url;
}
