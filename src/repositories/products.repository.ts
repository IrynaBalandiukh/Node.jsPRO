import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Product } from '../common/types';
import { isBigintId, Queryable } from './queryable';

export interface NewProduct {
  sellerId: string;
  name: string;
  description?: string;
  priceCents: number;
  stock?: number;
}

const COLUMNS = `id::text AS id, name, description, price_cents, stock`;

function map(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents,
    stock: row.stock,
  };
}

export class ProductsRepository {
  constructor(private readonly db: Queryable) {}

  async create(p: NewProduct): Promise<Product> {
    const { rows } = await this.db.query(
      `INSERT INTO products (seller_id, name, description, price_cents, stock)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [p.sellerId, p.name, p.description ?? '', p.priceCents, p.stock ?? 0],
    );
    return map(rows[0]);
  }

  async findById(id: string): Promise<Product | null> {
    if (!isBigintId(id)) return null;
    const { rows } = await this.db.query(`SELECT ${COLUMNS} FROM products WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  /** Повертає лише ті id, що існують (і активні). */
  async findExistingIds(ids: string[]): Promise<Set<string>> {
    const valid = ids.filter(isBigintId);
    if (valid.length === 0) return new Set();
    const { rows } = await this.db.query(
      `SELECT id::text AS id FROM products WHERE id = ANY($1::bigint[]) AND is_active`,
      [valid],
    );
    return new Set(rows.map((r) => r.id));
  }

  // Новіші першими (як у OpenAPI-спеці); id — тайбрейкер для стабільного порядку.
  async list(limit: number, offset: number): Promise<Product[]> {
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS} FROM products WHERE is_active
        ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(map);
  }

  /**
   * Атомарне списання зі складу: перевірка і декремент в одному UPDATE, без
   * вікна для гонки. false — товару не вистачає (або нема).
   */
  async decrementStock(id: string, quantity: number): Promise<boolean> {
    if (!isBigintId(id)) return false;
    const { rowCount } = await this.db.query(
      `UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2`,
      [id, quantity],
    );
    return rowCount === 1;
  }
}

@Injectable()
export class NestProductsRepository extends ProductsRepository {
  constructor(database: DatabaseService) {
    super(database.pool);
  }
}
