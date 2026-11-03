import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { isBigintId } from '../repositories/queryable';
import { OrderEventsService } from './order-events.service';
import { OrdersService } from './orders.service';

export type JoinResult =
  | { ok: true }
  | { ok: false; error: 'bad_request' | 'unauthorized' | 'forbidden' };

export const orderRoom = (orderId: string) => `orders:${orderId}`;

function identify(client: Socket): string | null {
  const userId: unknown = client.handshake.auth?.userId;
  return typeof userId === 'string' && userId !== '' ? userId : null;
}

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  private subscription?: Subscription;

  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  afterInit(server: Server): void {
    this.subscription = this.events.events$.subscribe((e) => {
      server.to(orderRoom(e.orderId)).emit('order.status', {
        order_id: e.orderId,
        status: e.status,
        changed_at: e.changedAt,
      });
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<JoinResult> {
    const orderId = (body as { orderId?: unknown } | null)?.orderId;
    if (typeof orderId !== 'string' || !isBigintId(orderId)) {
      return { ok: false, error: 'bad_request' };
    }
    const userId = identify(client);
    if (!userId) return { ok: false, error: 'unauthorized' };
    if (!(await this.orders.isOwnedBy(orderId, userId))) {
      return { ok: false, error: 'forbidden' };
    }
    await client.join(orderRoom(orderId));
    return { ok: true };
  }
}
