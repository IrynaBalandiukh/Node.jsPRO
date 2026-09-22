import 'reflect-metadata';
import * as path from 'node:path';
import { DataSource, DataSourceOptions, Logger as TypeOrmLogger } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// Підключення приходить лише з process.env (ДЗ №13, п.7) — його наповнює
// `infisical run` через scripts/with-secrets.sh (обгортка ДЗ №11), або
// SKIP_VAULT=1 напряму від грейдера/CI (п.8). Тут немає ні зашитого
// хоста/пароля, ні читання нового env-файла.
//
// DB_URL має пріоритет, якщо заданий (єдиний рядок підключення без ключа
// `password:` у коді); інакше — окремі DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/
// DB_NAME.
const DB_URL = process.env.DB_URL;

// Міграції — глоб, що охоплює і .ts (ts-node у розробці), і .js
// (скомпільований dist, яким користується CLI міграцій і npm-скрипти —
// підказка з ДЗ №13: "CLI міграцій працює зі скомпільованим DataSource").
const migrationsGlob = path.join(__dirname, 'migrations', '*.{js,ts}');

// Фабрика опцій, а не готовий інстанс, — щоб demo-nplus1.ts міг підняти
// власний DataSource із логуванням (['query'] + лічильник), не чіпаючи
// дефолтний AppDataSource (у seed.ts/report.ts логи вимкнені навмисно).
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
    // Прод-патерн: схему керують міграції, не introspection у рантаймі.
    synchronize: false,
    entities: [User, Product, Order, OrderItem],
    migrations: [migrationsGlob],
    logging: false,
    ...overrides,
  } as DataSourceOptions;
}

export type { TypeOrmLogger };

// Один-єдиний export DataSource-інстансу в цьому файлі — CLI міграцій
// (typeorm -d dist/data-source.js) вимагає рівно один.
const AppDataSource = new DataSource(buildDataSourceOptions());

export default AppDataSource;
