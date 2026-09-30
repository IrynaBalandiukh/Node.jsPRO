import 'reflect-metadata';
import { DataSource, In, Logger as TypeOrmLogger } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// Розмір вибірки варіюємо фільтром по email покупця (а не take/skip):
// find({ relations, take }) над to-many зв'язком TypeORM свідомо розбиває
// на 2 запити (ID-сторінка окремо від JOIN), щоб LIMIT не різав рядки
// посеред роздутого join'ом результату — коректна поведінка, але вона
// заважає показати "фікс = рівно 1 запит" на прикладі з пагінацією.
const SMALL_BUYERS = ['buyer1@seed.marketplace.dev', 'buyer2@seed.marketplace.dev'];

// Демо N+1 (ДЗ №13, п.5): граф order → items → product, 2 рівні зв'язків.
// Наївно: список замовлень одним запитом, тоді — окремий запит на items
// кожного замовлення в циклі, і ще окремий запит на product кожної
// позиції в циклі. Це видно тільки в лозі SQL — не в коді сервісу (тут
// метод виглядає як звичайний for-loop, нічого підозрілого).
//
// Власний Logger рахує SELECT-и (queryCountLogger — підказка з умови ДЗ).

class QueryCountLogger implements TypeOrmLogger {
  count = 0;

  reset(): void {
    this.count = 0;
  }

  logQuery(query: string): void {
    this.count++;
    console.log(`    [SQL ${this.count}] ${query}`);
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

/** Наївно: 1 запит на список + N запитів на items (у циклі) + M запитів на product кожної позиції (у циклі). */
async function runNaive(dataSource: DataSource, buyerEmails?: string[]): Promise<number> {
  const orderRepo = dataSource.getRepository(Order);
  const itemRepo = dataSource.getRepository(OrderItem);

  const orders = await orderRepo.find({
    where: buyerEmails ? { buyer: { email: In(buyerEmails) } } : {},
    order: { id: 'ASC' },
  }); // 1 запит

  for (const order of orders) {
    // Окремий SELECT на кожне замовлення — саме тут виникає N.
    const items = await itemRepo.find({ where: { order: { id: order.id } } });

    for (const item of items) {
      // Окремий SELECT на кожну позицію — другий рівень N+1 (product).
      await dataSource.getRepository(OrderItem).findOne({
        where: { id: item.id },
        relations: ['product'],
      });
    }
  }

  return orders.length;
}

/** Фікс: relations покриває обидва рівні (order → items → product) за один SQL-запит (JOIN). */
async function runFixed(dataSource: DataSource, buyerEmails?: string[]): Promise<number> {
  const orderRepo = dataSource.getRepository(Order);

  const orders = await orderRepo.find({
    where: buyerEmails ? { buyer: { email: In(buyerEmails) } } : {},
    order: { id: 'ASC' },
    relations: { items: { product: true } },
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
  console.log(`  замовлень оброблено: ${rows}, SQL-запитів: ${logger.count}`);
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

    const naiveSmall = await measure(dataSource, logger, 'НАЇВНО (запит у циклі)', runNaive, SMALL_BUYERS, smallCount);
    const naiveLarge = await measure(dataSource, logger, 'НАЇВНО (запит у циклі)', runNaive, undefined, largeCount);

    const fixedSmall = await measure(dataSource, logger, 'ФІКС (relations, JOIN)', runFixed, SMALL_BUYERS, smallCount);
    const fixedLarge = await measure(dataSource, logger, 'ФІКС (relations, JOIN)', runFixed, undefined, largeCount);

    console.log('\n=== Підсумок ===');
    console.log(`Наївно,  N=${smallCount}: ${naiveSmall} SQL-запитів (очікується >= ${smallCount})`);
    console.log(`Наївно,  N=${largeCount}: ${naiveLarge} SQL-запитів (очікується >= ${largeCount})`);
    console.log(`Фікс,    N=${smallCount}: ${fixedSmall} SQL-запит(и) (константа, не залежить від N)`);
    console.log(`Фікс,    N=${largeCount}: ${fixedLarge} SQL-запит(и) (константа, не залежить від N)`);

    const naiveGrows = naiveLarge > naiveSmall;
    const naiveAtLeastN = naiveSmall >= smallCount && naiveLarge >= largeCount;
    const fixedConstant = fixedSmall === fixedLarge && fixedLarge <= 1 + 2 * 2; // 1 + 2*рівнів (2 рівні)

    console.log(`\nдо ≥ N: ${naiveAtLeastN ? 'OK' : 'FAIL'} · до росте з N: ${naiveGrows ? 'OK' : 'FAIL'} · після — стала й <= 1+2*рівнів: ${fixedConstant ? 'OK' : 'FAIL'}`);

    if (!naiveAtLeastN || !naiveGrows || !fixedConstant) {
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('demo-nplus1 впав:', err);
  process.exit(1);
});
