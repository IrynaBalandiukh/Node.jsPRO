import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Order } from '../common/types';
import { isBigintId, Queryable } from './queryable';

export interface NewOrderItem {
  productId: string;
  quantity: number;
}

// Order + items in one query: LEFT JOIN order_items and json_agg.
const SELECT_ORDER = `
  SELECT o.id::text AS id, o.status, o.total_cents, o.created_at,
         COALESCE(
           json_agg(json_build_object(
             'product_id', oi.product_id::text,
             'quantity', oi.quantity,
             'unit_price_cents', oi.unit_price_cents
           ) ORDER BY oi.id) FILTER (WHERE oi.id IS NOT NULL),
           '[]'::json
         ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id`;

function map(row: any): Order {
  return {
    id: row.id,
    status: row.status,
    items: row.items,
    total_cents: row.total_cents,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export class OrdersRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Creates an order with its items in ONE atomic statement (CTE): the price
   * is taken from products at creation time, total is computed in SQL. No
   * partially created orders, and the method works with any Queryable.
   */
  async create(buyerId: string, items: NewOrderItem[]): Promise<Order> {
    const { rows } = await this.db.query(
      `WITH lines AS (
         SELECT p.id AS product_id, i.quantity, p.price_cents
           FROM unnest($2::bigint[], $3::int[]) AS i(product_id, quantity)
           JOIN products p ON p.id = i.product_id
       ), o AS (
         INSERT INTO orders (buyer_id, status, total_cents)
         SELECT $1, 'pending', COALESCE(SUM(price_cents * quantity), 0)::int FROM lines
         RETURNING id
       ), ins AS (
         INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
         SELECT o.id, l.product_id, l.quantity, l.price_cents FROM o CROSS JOIN lines l
         RETURNING 1
       )
       SELECT id::text AS id FROM o`,
      [buyerId, items.map((i) => i.productId), items.map((i) => i.quantity)],
    );
    const order = await this.findById(rows[0].id);
    return order!;
  }

  async findById(id: string): Promise<Order | null> {
    if (!isBigintId(id)) return null;
    const { rows } = await this.db.query(`${SELECT_ORDER} WHERE o.id = $1 GROUP BY o.id`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  async list(limit: number, offset: number): Promise<Order[]> {
    const { rows } = await this.db.query(
      `${SELECT_ORDER} GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(map);
  }
}

@Injectable()
export class NestOrdersRepository extends OrdersRepository {
  constructor(database: DatabaseService) {
    super(database.pool);
  }
}
