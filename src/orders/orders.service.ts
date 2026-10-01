import { Injectable } from '@nestjs/common';
import { Order } from '../common/types';
import { NestOrdersRepository } from '../repositories/orders.repository';
import { NestProductsRepository } from '../repositories/products.repository';
import { NestUsersRepository } from '../repositories/users.repository';

export interface CreateOrderResult {
  order?: Order;
  error?: 'product_not_found';
}

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  body: Order;
}

// У поточній версії API немає авторизації (див. openapi.yaml), тож замовлення
// оформлюються від імені одного службового покупця; створюється лениво й
// ідемпотентно (INSERT ... ON CONFLICT).
const GUEST_BUYER = {
  email: 'guest-buyer@marketplace.local',
  passwordHash: '!',
  role: 'buyer' as const,
};

@Injectable()
export class OrdersService {
  readonly idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly orders: NestOrdersRepository,
    private readonly products: NestProductsRepository,
    private readonly users: NestUsersRepository,
  ) {}

  findAll(limit: number, offset: number): Promise<Order[]> {
    return this.orders.list(limit, offset);
  }

  findById(id: string): Promise<Order | null> {
    return this.orders.findById(id);
  }

  async create(items: Array<{ product_id: string; quantity: number }>): Promise<CreateOrderResult> {
    const existing = await this.products.findExistingIds(items.map((i) => i.product_id));
    if (items.some((i) => !existing.has(i.product_id))) {
      return { error: 'product_not_found' };
    }

    const buyer = await this.users.ensure(GUEST_BUYER);
    const order = await this.orders.create(
      buyer.id,
      items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
    );
    return { order };
  }
}
