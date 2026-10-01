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

// Матчить db/schema.sql: products (ДЗ №3), з одним свідомим редизайном —
// ціна в мінорних одиницях (integer price_cents), не numeric/float, як цього
// вимагає ДЗ №13. search_vector (generated tsvector + GIN, ДЗ №3) у ORM-шар
// свідомо не переносимо: FTS не входить у relations/N+1/report-задачі цього
// ДЗ, а generated STORED-колонку TypeORM entity/migration-генератор не вміє
// виразити декларативно без ручного SQL, що додало б складності без користі
// для acceptance criteria. Raw-SQL дизайн (db/) лишається задокументованим
// джерелом істини для повнотекстового пошуку.
@Entity({ name: 'products' })
@Check(`"price_cents" > 0`)
@Check(`"stock" >= 0`)
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Index('idx_products_seller_id')
  @ManyToOne(() => User, (user) => user.products, {
    nullable: false,
    // Історія товарів продавця має лишатись: продавця з товарами видалити
    // не можна (керуй через soft-delete/деактивацію користувача, не DELETE).
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'seller_id' })
  seller!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  // Гроші — integer у мінорних одиницях (копійки), не numeric/float.
  @Column({ name: 'price_cents', type: 'integer' })
  priceCents!: number;

  @Column({ type: 'integer', default: 0 })
  stock!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems!: OrderItem[];
}
