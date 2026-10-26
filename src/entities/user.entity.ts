import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, Check } from 'typeorm';
import { Product } from './product.entity';
import { Order } from './order.entity';

export type UserRole = 'buyer' | 'seller';

// Mirrors db/schema.sql: users. The role is enforced by a CHECK constraint in
// the database (not only by the TS type), same contract as in db/schema.sql.
@Entity({ name: 'users' })
@Check('chk_users_role', `"role" IN ('buyer', 'seller')`)
@Check('CHK_users_balance_non_negative', `"balance_cents" >= 0`)
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  // Uniqueness is enforced by the case-insensitive unique index
  // idx_users_email_lower (on lower(email)), created in the migration:
  // @Index cannot express an expression index.
  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text' })
  role!: UserRole;

  // Balance in cents (integer, not float); debited in checkout by an atomic
  // UPDATE ... WHERE balance_cents >= $n. The CHECK >= 0 is a safety net in the DB.
  @Column({ name: 'balance_cents', type: 'integer', default: 0 })
  balanceCents!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // 1──n: the user as a seller of their products.
  @OneToMany(() => Product, (product) => product.seller)
  products!: Product[];

  // 1──n: the user as a buyer of their orders.
  @OneToMany(() => Order, (order) => order.buyer)
  orders!: Order[];
}
