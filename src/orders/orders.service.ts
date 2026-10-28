import { Injectable } from '@nestjs/common';
import { Order, OrderStatus, statusesBefore } from '../common/types';
import { DatabaseService } from '../database/database.service';
import { NestOrdersRepository } from '../repositories/orders.repository';
import { NestProductsRepository } from '../repositories/products.repository';
import { RepositoriesFactory } from '../repositories/repositories.factory';
import { NestUsersRepository } from '../repositories/users.repository';
import { OrderEventsService } from './order-events.service';

export interface CreateOrderResult {
  order?: Order;
  error?: 'product_not_found' | 'insufficient_stock';
  productId?: string;
}

class InsufficientStockError extends Error {
  constructor(readonly productId: string) {
    super(`Not enough stock for product ${productId}`);
  }
}

export interface ChangeStatusResult {
  order?: Order;
  error?: 'order_not_found' | 'invalid_transition';
}

export interface IdempotencyRecord {
  bodyHash: string;
  status: number;
  body: Order;
}

// The current API version has no authorization (see openapi.yaml), so orders
// are placed on behalf of a single service buyer, created lazily and
// idempotently (INSERT ... ON CONFLICT).
const GUEST_BUYER = {
  email: 'guest-buyer@marketplace.local',
  passwordHash: '!',
  role: 'buyer' as const,
};

@Injectable()
export class OrdersService {
  readonly idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly database: DatabaseService,
    private readonly repositories: RepositoriesFactory,
    private readonly orders: NestOrdersRepository,
    private readonly products: NestProductsRepository,
    private readonly users: NestUsersRepository,
    private readonly events: OrderEventsService,
  ) {}

  findAll(limit: number, offset: number): Promise<Order[]> {
    return this.orders.list(limit, offset);
  }

  findById(id: string): Promise<Order | null> {
    return this.orders.findById(id);
  }

  isOwnedBy(orderId: string, userId: string): Promise<boolean> {
    return this.orders.isOwnedBy(orderId, userId);
  }

  async changeStatus(
    id: string,
    status: Exclude<OrderStatus, 'pending'>,
  ): Promise<ChangeStatusResult> {
    const order = await this.database.withTransaction(async (client) => {
      const { products, orders } = this.repositories.forClient(client);
      if (!(await orders.transition(id, statusesBefore(status), status))) return null;
      if (status === 'cancelled') await products.restockOrder(id);
      return orders.findById(id);
    });
    if (!order) {
      const exists = await this.orders.findById(id);
      return { error: exists ? 'invalid_transition' : 'order_not_found' };
    }

    this.events.publish({
      orderId: id,
      status: order.status,
      changedAt: new Date().toISOString(),
    });
    return { order };
  }

  async create(
    items: Array<{ product_id: string; quantity: number }>,
  ): Promise<CreateOrderResult> {
    const existing = await this.products.findExistingIds(
      items.map((i) => i.product_id),
    );
    if (items.some((i) => !existing.has(i.product_id))) {
      return { error: 'product_not_found' };
    }

    const buyer = await this.users.ensure(GUEST_BUYER);

    const sorted = [...items].sort((a, b) => {
      const x = BigInt(a.product_id);
      const y = BigInt(b.product_id);
      return x < y ? -1 : x > y ? 1 : 0;
    });

    try {
      const order = await this.database.withTransaction(async (client) => {
        const { products, orders } = this.repositories.forClient(client);
        for (const item of sorted) {
          if (
            !(await products.decrementStock(item.product_id, item.quantity))
          ) {
            throw new InsufficientStockError(item.product_id);
          }
        }
        return orders.create(
          buyer.id,
          items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
        );
      });
      return { order };
    } catch (err) {
      if (err instanceof InsufficientStockError) {
        return { error: 'insufficient_stock', productId: err.productId };
      }
      throw err;
    }
  }
}
