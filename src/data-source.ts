import 'reflect-metadata';
import * as path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Job } from './entities/job.entity';

// Connection settings come only from process.env (nothing hardcoded).
// DB_URL (or its synonym DATABASE_URL), if set, wins; otherwise DB_HOST /
// DB_PORT / DB_USER / DB_PASSWORD / DB_NAME are used.
const DB_URL = process.env.DB_URL ?? process.env.DATABASE_URL;

// Matches both .ts (ts-node) and .js (compiled dist, used by the migration
// CLI). Glob patterns need forward slashes, also on Windows.
const migrationsGlob = path
  .join(__dirname, 'migrations', '*.{js,ts}')
  .replace(/\\/g, '/');

// A factory instead of a ready instance, so demo-nplus1.ts can build its own
// DataSource with query logging without touching the default one.
export function buildDataSourceOptions(overrides: Partial<DataSourceOptions> = {}): DataSourceOptions {
  return {
    type: 'postgres',
    ...(DB_URL
      ? { url: DB_URL }
      : {
          host: process.env.DB_HOST,
          port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
          username: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
        }),
    // The schema is managed by migrations only.
    synchronize: false,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [migrationsGlob],
    logging: false,
    ...overrides,
  } as DataSourceOptions;
}

// The migration CLI requires exactly one DataSource export in this file.
const AppDataSource = new DataSource(buildDataSourceOptions());

export default AppDataSource;
