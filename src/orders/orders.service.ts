import { Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { Order, OrderItem } from '../common/types';

export interface CreateOrderResult {
  order?: Order;
  error?: 'product_not_found';
}

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  body: Order;
}

@Injectable()
export class OrdersService {
  private readonly orders: Order[] = [];
  private nextOrderNumber = 1;
  readonly idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(private readonly productsService: ProductsService) {}

  findAll(): Order[] {
    return this.orders;
  }

  findById(id: string): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  create(items: Array<{ product_id: string; quantity: number }>): CreateOrderResult {
    const orderItems: (OrderItem | null)[] = items.map(({ product_id, quantity }) => {
      const product = this.productsService.findById(product_id);
      return product ? { product_id, quantity, unit_price_cents: product.price_cents } : null;
    });

    if (orderItems.some((item) => item === null)) {
      return { error: 'product_not_found' };
    }

    const resolvedItems = orderItems as OrderItem[];
    const total_cents = resolvedItems.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);

    const order: Order = {
      id: `order_${this.nextOrderNumber++}`,
      status: 'pending',
      items: resolvedItems,
      total_cents,
      created_at: new Date().toISOString(),
    };

    this.orders.push(order);
    return { order };
  }
}
