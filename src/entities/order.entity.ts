import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  CreateDateColumn,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

export type OrderStatus = 'pending' | 'paid' | 'cancelled';

// Mirrors db/schema.sql: orders. total_cents is a bigint in minor units (the
// sum of the order items), never numeric/float. bigint values arrive from the
// driver as strings, hence the string type.
@Entity({ name: 'orders' })
@Check('chk_orders_status', `"status" IN ('pending', 'paid', 'cancelled')`)
@Check('chk_orders_total_nonneg', `"total_cents" >= 0`)
// Composite index for q1 (buyer_id + created_at): the order history of one
// buyer over a period.
@Index('idx_orders_buyer_created', ['buyer', 'createdAt'])
// Partial index for the "pending orders" panel. The where text matches how
// Postgres stores it, so the schema check sees no difference.
@Index('idx_orders_pending_created', ['createdAt'], { where: `(status = 'pending'::text)` })
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    // A buyer's order history must be kept: a buyer who has orders cannot be
    // deleted.
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: User;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ name: 'total_cents', type: 'bigint' })
  totalCents!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];
}
