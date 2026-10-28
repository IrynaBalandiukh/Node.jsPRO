import 'reflect-metadata';
import * as path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Job } from './entities/job.entity';

const DB_URL = process.env.DB_URL ?? process.env.DATABASE_URL;

const migrationsGlob = path
  .join(__dirname, 'migrations', '*.{js,ts}')
  .replace(/\\/g, '/');

export function buildDataSourceOptions(
  overrides: Partial<DataSourceOptions> = {},
): DataSourceOptions {
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
    synchronize: false,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [migrationsGlob],
    logging: false,
    ...overrides,
  } as DataSourceOptions;
}

const AppDataSource = new DataSource(buildDataSourceOptions());

export default AppDataSource;
