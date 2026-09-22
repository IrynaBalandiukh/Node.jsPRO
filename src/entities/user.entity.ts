import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index, CreateDateColumn, Check } from 'typeorm';
import { Product } from './product.entity';
import { Order } from './order.entity';

export type UserRole = 'buyer' | 'seller' | 'admin';

// Матчить db/schema.sql: users (ДЗ №3). Роль перевіряється CHECK-констрейнтом
// у БД (не тільки TS-типом) — той самий контракт, що й у db/schema.sql.
@Entity({ name: 'users' })
@Check(`"role" IN ('buyer', 'seller', 'admin')`)
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Index('idx_users_email', { unique: true })
  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text' })
  role!: UserRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // 1──n: користувач як продавець своїх товарів.
  @OneToMany(() => Product, (product) => product.seller)
  products!: Product[];

  // 1──n: користувач як покупець своїх замовлень.
  @OneToMany(() => Order, (order) => order.buyer)
  orders!: Order[];
}
