import 'reflect-metadata';
import AppDataSource from './data-source';
import { OrderItem } from './entities/order-item.entity';

// Report: top sellers by revenue (paid orders only) — aggregates (SUM/COUNT),
// GROUP BY and 3 JOINs. find()/findOne() cannot express this: they return
// entity graphs, not computed rows.

interface RevenueBySellerRow {
  seller_id: string;
  seller_email: string;
  revenue_cents: string; // bigint arrives from Postgres as a string
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
      .getRawMany<RevenueBySellerRow>();

    console.log('Top sellers by revenue (status = paid only):\n');
    console.log('seller_id  seller_email                          revenue    orders_count');
    console.log('---------  ---------------------------------  ----------  --------------');

    for (const row of rows) {
      // SUM/COUNT arrive as strings; Number() is fine for printing at this
      // data size.
      const revenue = (Number(row.revenue_cents) / 100).toFixed(2);
      console.log(
        `${row.seller_id.padEnd(9)}  ${row.seller_email.padEnd(33)}  ${revenue.padStart(10)}  ${row.orders_count.padStart(14)}`,
      );
    }

    if (rows.length === 0) {
      console.log('(no data — run npm run seed first)');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('report failed:', err);
  process.exit(1);
});
