import 'reflect-metadata';
import AppDataSource from './data-source';
import { OrderItem } from './entities/order-item.entity';

// Звіт через QueryBuilder (ДЗ №13, п.6): "топ продавців за виторгом (оплачені
// замовлення)" — агрегат (SUM/COUNT) + GROUP BY + 3 JOIN
// (order_items → order, order_items → product, product → seller). Це не
// виразити через find()/findOne(): їм невідомі агрегатні функції та
// GROUP BY, вони повертають entity-графи, а не обчислені рядки.

interface RevenueByCellerRow {
  seller_id: string;
  seller_email: string;
  revenue_cents: string; // bigint з Postgres приходить рядком
  orders_count: string;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const rows = await AppDataSource.getRepository(OrderItem)
      .createQueryBuilder('item')
      .innerJoin('item.order', 'ord')
      .innerJoin('item.product', 'product')
      .innerJoin('product.seller', 'seller')
      .where('ord.status = :status', { status: 'paid' })
      .select('seller.id', 'seller_id')
      .addSelect('seller.email', 'seller_email')
      .addSelect('SUM(item.quantity * item.unit_price_cents)', 'revenue_cents')
      .addSelect('COUNT(DISTINCT ord.id)', 'orders_count')
      .groupBy('seller.id')
      .addGroupBy('seller.email')
      .orderBy('revenue_cents', 'DESC')
      .limit(10)
      .getRawMany<RevenueByCellerRow>();

    console.log('Топ продавців за виторгом (тільки status = paid):\n');
    console.log('seller_id  seller_email                       виторг      к-ть замовлень');
    console.log('---------  ---------------------------------  ----------  --------------');

    for (const row of rows) {
      // bigint з SUM/COUNT приходить рядком — Number() тут безпечний лише
      // для друку (курсовий обсяг даних невеликий); на реальних мільйонах
      // рядків це поле лишають строкою/BigInt.
      const revenue = (Number(row.revenue_cents) / 100).toFixed(2);
      console.log(
        `${row.seller_id.padEnd(9)}  ${row.seller_email.padEnd(33)}  ${revenue.padStart(10)}  ${row.orders_count.padStart(14)}`,
      );
    }

    if (rows.length === 0) {
      console.log('(даних немає — спочатку запусти npm run seed)');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('report впав:', err);
  process.exit(1);
});
