import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as crypto from 'node:crypto';
import { OrdersService } from './orders.service';
import { paginateQuery, Page } from '../common/pagination';
import { NotFoundError, UnprocessableEntityError } from '../common/errors';
import { Order } from '../common/types';

interface CreateOrderBody {
  items: Array<{ product_id: string; quantity: number }>;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<Order>> {
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

  @Post()
  async create(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: CreateOrderBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Order> {
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');

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

    const { order, error } = await this.ordersService.create(body.items);
    if (error === 'product_not_found' || !order) {
      throw new NotFoundError('One or more products referenced in items do not exist');
    }

    this.ordersService.idempotencyStore.set(idempotencyKey, { bodyHash, status: 201, body: order });
    res.status(201);
    return order;
  }
}
