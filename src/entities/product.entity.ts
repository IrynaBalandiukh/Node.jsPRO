import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

// Mirrors db/schema.sql: products. The price is an integer in minor units
// (price_cents), never numeric/float. search_vector (generated tsvector + GIN)
// is deliberately not mapped here: full-text search is outside the
// relations/N+1/report scope of this assignment, and TypeORM's entity and
// migration generator cannot express a generated STORED column declaratively
// without hand-written SQL. The raw-SQL design in db/ remains the source of
// truth for full-text search.
@Entity({ name: 'products' })
@Check('chk_products_price_positive', `"price_cents" > 0`)
@Check('chk_products_stock_nonneg', `"stock" >= 0`)
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @ManyToOne(() => User, (user) => user.products, {
    nullable: false,
    // A seller's product history must be kept: a seller who has products
    // cannot be deleted (deactivate the user instead of DELETE).
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'seller_id' })
  seller!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // Money is an integer in minor units (cents), never numeric/float.
  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ type: 'integer', default: 0 })
  stock!: number;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  photos!: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems!: OrderItem[];
}
