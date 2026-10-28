import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check } from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

// Mirrors db/schema.sql: order_items. It is the M:N link between Order and
// Product, but it carries data of its own (quantity and the unit price at
// order time), so it is an explicit join entity rather than @ManyToMany.
// unit_price_cents is an integer in minor units, never numeric/float.
@Entity({ name: 'order_items' })
@Check('chk_order_items_quantity_positive', `"quantity" > 0`)
@Check('chk_order_items_unit_price_positive', `"unit_price_cents" > 0`)
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    // Children follow the parent: deleting an order deletes its items.
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne(() => Product, (product) => product.orderItems, {
    nullable: false,
    // Order history is protected: a product referenced by existing
    // order_items cannot be deleted (RESTRICT), otherwise the financial
    // history would lose track of what was actually bought.
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'integer' })
  quantity!: number;

  // Price at order time (may differ from the current Product.priceCents).
  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents!: number;
}
