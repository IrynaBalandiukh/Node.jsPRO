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

// Матчить db/schema.sql: orders (ДЗ №3). total_amount_cents — integer у
// мінорних одиницях (сума позицій замовлення), не numeric/float.
@Entity({ name: 'orders' })
@Check(`"status" IN ('pending', 'paid', 'cancelled')`)
@Check(`"total_amount_cents" >= 0`)
// Композитний індекс під q1 з ДЗ №3 (buyer_id + created_at): історія
// замовлень конкретного покупця за період.
@Index('idx_orders_buyer_created', ['buyer', 'createdAt'])
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    // Історія замовлень покупця має лишатись: покупця із замовленнями
    // видалити не можна.
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'buyer_id' })
  buyer!: User;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ name: 'total_amount_cents', type: 'integer' })
  totalAmountCents!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];
}
