import 'reflect-metadata';
import { DataSource, In, Logger as TypeOrmLogger } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// The sample size is varied by buyer email, not by take/skip: with a to-many
// relation TypeORM splits find({ relations, take }) into 2 queries, which
// would hide the "fix = exactly 1 query" result.
const SMALL_BUYERS = ['buyer1@seed.marketplace.dev', 'buyer2@seed.marketplace.dev'];

// N+1 demo for the graph order -> items -> product (2 levels of relations).
// Naive: one query for the orders, then one query per order for its items and
// one query per item for its product. The problem is visible only in the SQL
// log, not in the code (it looks like a plain for-loop).

const PRINTED_QUERIES = 5;

class QueryCountLogger implements TypeOrmLogger {
  count = 0;

  reset(): void {
    this.count = 0;
  }

  // Prints a one-line summary of the first few queries; the rest are only counted.
  logQuery(query: string): void {
    this.count++;
    if (this.count > PRINTED_QUERIES) return;
    const verb = query.trim().split(/\s+/)[0];
    const table = /FROM "(\w+)"/.exec(query)?.[1] ?? '?';
    const where = /WHERE (.*)$/s.exec(query)?.[1]?.replace(/\s+/g, ' ').slice(0, 60);
    console.log(`    [SQL ${this.count}] ${verb} ${table}${where ? ` WHERE ${where}` : ''}`);
  }

  logQueryError(error: string | Error, query: string): void {
    console.error('    [SQL error]', query, error);
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  logQuerySlow(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  logSchemaBuild(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  logMigration(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  log(): void {}
}

/** Naive: 1 query for the list + 1 per order (items) + 1 per item (product). */
async function runNaive(dataSource: DataSource, buyerEmails?: string[]): Promise<number> {
  const orderRepo = dataSource.getRepository(Order);
  const itemRepo = dataSource.getRepository(OrderItem);

  const orders = await orderRepo.find({
    where: buyerEmails ? { buyer: { email: In(buyerEmails) } } : {},
    order: { id: 'ASC' },
  }); // 1 query

  for (const order of orders) {
    // One SELECT per order: this is where N comes from.
    const items = await itemRepo.find({ where: { order: { id: order.id } } });

    for (const item of items) {
      // One SELECT per item: the second level of N+1.
      await dataSource.getRepository(OrderItem).findOne({
        where: { id: item.id },
        relations: ['product'],
      });
    }
  }

  return orders.length;
}

/** Fix 1: relations covers both levels in a single JOIN query. */
async function runFixed(dataSource: DataSource, buyerEmails?: string[]): Promise<number> {
  const orderRepo = dataSource.getRepository(Order);

  const orders = await orderRepo.find({
    where: buyerEmails ? { buyer: { email: In(buyerEmails) } } : {},
    order: { id: 'ASC' },
    relations: { items: { product: true } },
  });

  return orders.length;
}

/** Fix 2: relationLoadStrategy 'query' loads each relation with one batched SELECT ... WHERE id IN (...). */
async function runFixedQuery(dataSource: DataSource, buyerEmails?: string[]): Promise<number> {
  const orderRepo = dataSource.getRepository(Order);

  const orders = await orderRepo.find({
    where: buyerEmails ? { buyer: { email: In(buyerEmails) } } : {},
    order: { id: 'ASC' },
    relations: { items: { product: true } },
    relationLoadStrategy: 'query',
  });

  return orders.length;
}

async function measure(
  dataSource: DataSource,
  logger: QueryCountLogger,
  label: string,
  run: (ds: DataSource, buyerEmails?: string[]) => Promise<number>,
  buyerEmails: string[] | undefined,
  n: number,
): Promise<number> {
  logger.reset();
  console.log(`\n--- ${label} (N=${n}) ---`);
  const rows = await run(dataSource, buyerEmails);
  if (logger.count > PRINTED_QUERIES) console.log(`    ... and ${logger.count - PRINTED_QUERIES} more`);
  console.log(`  orders processed: ${rows}, SQL queries: ${logger.count}`);
  return logger.count;
}

async function main(): Promise<void> {
  const logger = new QueryCountLogger();
  const dataSource = new DataSource(
    buildDataSourceOptions({
      logging: ['query'],
      logger,
    }),
  );

  await dataSource.initialize();
  try {
    const smallCount = await dataSource
      .getRepository(Order)
      .count({ where: { buyer: { email: In(SMALL_BUYERS) } } });
    const largeCount = await dataSource.getRepository(Order).count();

    const naiveSmall = await measure(dataSource, logger, 'NAIVE (query in a loop)', runNaive, SMALL_BUYERS, smallCount);
    const naiveLarge = await measure(dataSource, logger, 'NAIVE (query in a loop)', runNaive, undefined, largeCount);

    const fixedSmall = await measure(dataSource, logger, 'FIX (relations, JOIN)', runFixed, SMALL_BUYERS, smallCount);
    const fixedLarge = await measure(dataSource, logger, 'FIX (relations, JOIN)', runFixed, undefined, largeCount);

    const querySmall = await measure(dataSource, logger, "FIX (relationLoadStrategy: 'query')", runFixedQuery, SMALL_BUYERS, smallCount);
    const queryLarge = await measure(dataSource, logger, "FIX (relationLoadStrategy: 'query')", runFixedQuery, undefined, largeCount);

    console.log('\n=== Summary ===');
    console.log(`Naive,   N=${smallCount}: ${naiveSmall} SQL queries (expected >= ${smallCount})`);
    console.log(`Naive,   N=${largeCount}: ${naiveLarge} SQL queries (expected >= ${largeCount})`);
    console.log(`Fix,     N=${smallCount}: ${fixedSmall} SQL query(ies) (constant, independent of N)`);
    console.log(`Fix,     N=${largeCount}: ${fixedLarge} SQL query(ies) (constant, independent of N)`);

    console.log(`Query,   N=${smallCount}: ${querySmall} SQL queries (independent of N, <= 1 + 2 * levels = 5)`);
    console.log(`Query,   N=${largeCount}: ${queryLarge} SQL queries (independent of N, <= 1 + 2 * levels = 5)`);

    const naiveGrows = naiveLarge > naiveSmall;
    const naiveAtLeastN = naiveSmall >= smallCount && naiveLarge >= largeCount;
    const fixedConstant = fixedSmall === fixedLarge && fixedLarge <= 1 + 2 * 2; // 1 + 2 * levels (2 levels)
    const queryConstant = querySmall === queryLarge && queryLarge <= 1 + 2 * 2;

    console.log(`\nbefore >= N: ${naiveAtLeastN ? 'OK' : 'FAIL'} · before grows with N: ${naiveGrows ? 'OK' : 'FAIL'} · after is constant and <= 1+2*levels: ${fixedConstant ? 'OK' : 'FAIL'} · query strategy is constant and <= 5: ${queryConstant ? 'OK' : 'FAIL'}`);

    if (!naiveAtLeastN || !naiveGrows || !fixedConstant || !queryConstant) {
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('demo-nplus1 failed:', err);
  process.exit(1);
});
