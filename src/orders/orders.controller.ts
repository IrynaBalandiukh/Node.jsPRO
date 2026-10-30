import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { Response } from 'express';
import * as crypto from 'node:crypto';
import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';
import { paginateQuery, Page } from '../common/pagination';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../common/errors';
import { PROBLEM_URIS } from '../common/problem-json';
import { Order, OrderStatus } from '../common/types';

// Reconnect delay for EventSource; the default is several seconds.
const SSE_RETRY_MS = 1000;

interface CreateOrderBody {
  items: Array<{ product_id: string; quantity: number }>;
}

interface ChangeStatusBody {
  status: Exclude<OrderStatus, 'pending'>;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<Order>> {
    return paginateQuery((l, o) => this.ordersService.findAll(l, o), {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':orderId')
  async getById(@Param('orderId') orderId: string): Promise<Order> {
    const order = await this.ordersService.findById(orderId);
    if (!order) {
      throw new NotFoundError(`Order '${orderId}' was not found`);
    }
    return order;
  }

  @Sse(':orderId/events')
  async streamEvents(
    @Param('orderId') orderId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    if (!(await this.ordersService.findById(orderId))) {
      throw new NotFoundError(`Order '${orderId}' was not found`);
    }
    const afterId =
      lastEventId && /^\d+$/.test(lastEventId) ? Number(lastEventId) : 0;
    return this.events.stream(orderId, afterId).pipe(
      map((e) => ({
        id: String(e.id),
        type: 'order.status',
        retry: SSE_RETRY_MS,
        data: {
          order_id: e.orderId,
          status: e.status,
          changed_at: e.changedAt,
        },
      })),
    );
  }

  @Patch(':orderId/status')
  async changeStatus(
    @Param('orderId') orderId: string,
    @Body() body: ChangeStatusBody,
  ): Promise<Order> {
    const { order, error } = await this.ordersService.changeStatus(
      orderId,
      body.status,
    );
    if (error === 'order_not_found') {
      throw new NotFoundError(`Order '${orderId}' was not found`);
    }
    if (error === 'invalid_transition') {
      throw new ConflictError(
        `Order '${orderId}' cannot move to '${body.status}' from its current status`,
        PROBLEM_URIS.invalidStatusTransition,
      );
    }
    return order!;
  }

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: CreateOrderBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Order> {
    const bodyHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex');

    const stored = this.ordersService.idempotencyStore.get(idempotencyKey);
    if (stored) {
      if (stored.bodyHash !== bodyHash) {
        throw new UnprocessableEntityError(
          `Idempotency-Key '${idempotencyKey}' was already used with a different request body`,
        );
      }
      res.set('Idempotency-Replay', 'true');
      res.status(stored.status);
      return stored.body;
    }

    const { order, error, productId } = await this.ordersService.create(
      body.items,
    );
    if (error === 'insufficient_stock') {
      throw new ConflictError(
        `Not enough stock for product '${productId}'`,
        PROBLEM_URIS.insufficientStock,
      );
    }
    if (error === 'product_not_found' || !order) {
      throw new NotFoundError(
        'One or more products referenced in items do not exist',
      );
    }

    this.ordersService.idempotencyStore.set(idempotencyKey, {
      bodyHash,
      status: 201,
      body: order,
    });
    res.status(201);
    return order;
  }
}
