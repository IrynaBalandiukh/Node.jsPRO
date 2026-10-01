import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

// Матчить db/schema.sql: order_items (ДЗ №3) — M:N між Order і Product,
// але з даними на зв'язку (quantity, unit_price на момент замовлення), тому
// свідома явна join-entity, а не @ManyToMany. unit_price_cents — integer у
// мінорних одиницях, не numeric/float.
@Entity({ name: 'order_items' })
@Check(`"quantity" > 0`)
@Check(`"unit_price_cents" > 0`)
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Index('idx_order_items_order_id')
  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    // Діти йдуть за батьком: видалення замовлення видаляє його позиції.
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @Index('idx_order_items_product_id')
  @ManyToOne(() => Product, (product) => product.orderItems, {
    nullable: false,
    // Історія замовлень захищена: товар, на який посилаються існуючі
    // order_items, видалити не можна (RESTRICT), інакше фінансова історія
    // втрачає зв'язок з тим, що саме було куплено.
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'integer' })
  quantity!: number;

  // Ціна на момент замовлення (може відрізнятись від поточної Product.priceCents).
  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents!: number;
}
