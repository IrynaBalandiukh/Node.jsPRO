import { Injectable } from '@nestjs/common';
import { concat, filter, from, Observable, Subject } from 'rxjs';
import { OrderStatus } from '../common/types';

export interface OrderStatusEvent {
  id: number;
  orderId: string;
  status: OrderStatus;
  changedAt: string;
}

const MAX_EVENTS_PER_ORDER = 100;
const MAX_ORDERS_IN_BUFFER = 1000;

@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderStatusEvent>();
  readonly events$: Observable<OrderStatusEvent> = this.subject.asObservable();

  private readonly buffer = new Map<string, OrderStatusEvent[]>();
  // Last id per order, kept even after the history is evicted from `buffer`: if the
  // numbering restarted at 1, a client with Last-Event-ID: 7 would never see new events.
  private readonly lastIds = new Map<string, number>();

  publish(event: Omit<OrderStatusEvent, 'id'>): OrderStatusEvent {
    const history = this.buffer.get(event.orderId) ?? [];
    const published: OrderStatusEvent = {
      ...event,
      id: (this.lastIds.get(event.orderId) ?? 0) + 1,
    };
    this.lastIds.set(event.orderId, published.id);

    history.push(published);
    if (history.length > MAX_EVENTS_PER_ORDER) history.shift();
    this.buffer.set(event.orderId, history);
    if (this.buffer.size > MAX_ORDERS_IN_BUFFER) {
      this.buffer.delete(this.buffer.keys().next().value as string);
    }

    this.subject.next(published);
    return published;
  }

  stream(orderId: string, afterId = 0): Observable<OrderStatusEvent> {
    return new Observable<OrderStatusEvent>((subscriber) => {
      const missed = (this.buffer.get(orderId) ?? []).filter(
        (e) => e.id > afterId,
      );
      const lastSeen = missed[missed.length - 1]?.id ?? afterId;
      return concat(
        from(missed),
        this.events$.pipe(
          filter((e) => e.orderId === orderId && e.id > lastSeen),
        ),
      ).subscribe(subscriber);
    });
  }
}
