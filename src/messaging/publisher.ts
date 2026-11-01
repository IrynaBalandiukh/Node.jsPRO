import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { EVENTS_EXCHANGE, ORDER_PLACED_KEY } from './topology';
import type { OrderPlacedEvent } from './events';

export class UnroutableError extends Error {
  constructor(routingKey: string) {
    super(`Message with routing key "${routingKey}" was returned by the broker: no binding matched`);
  }
}

// ── Публікація (крок 2) ───────────────────────────────────────────────────
// createConfirmChannel + waitForConfirms: «опублікував» = брокер взяв відповідальність
// (для quorum-черги це означає: записано на більшість нод), а не «віддав у сокет».
// mandatory: true: якщо жоден binding не збігся, брокер повертає повідомлення (basic.return),
// і ми кидаємо помилку: інакше позитивний confirm приховав би «порожній звук».
// Продюсер НЕ оголошує топологію: exchange уже створений бутстрапом/споживачем.
export class EventPublisher {
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private returned = new Set<string>();

  constructor(private readonly url: string) {}

  private async ensureChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return this.channel;
    const connection = await amqp.connect(this.url);
    connection.on('error', () => undefined); // «close» нижче скидає стан
    connection.on('close', () => {
      this.connection = undefined;
      this.channel = undefined;
    });
    const channel = await connection.createConfirmChannel();
    channel.on('return', (msg) => this.returned.add(msg.properties.messageId));
    this.connection = connection;
    this.channel = channel;
    return channel;
  }

  async publish(event: OrderPlacedEvent): Promise<void> {
    await this.publishBody(Buffer.from(JSON.stringify(event)), event.eventId, {
      type: event.type,
      timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
    });
  }

  /** Публікація «як є», без контракту: лише для демо отруєного повідомлення. */
  async publishRaw(body: Buffer, messageId: string): Promise<void> {
    await this.publishBody(body, messageId, {});
  }

  private async publishBody(body: Buffer, messageId: string, extra: amqp.Options.Publish): Promise<void> {
    const channel = await this.ensureChannel();
    channel.publish(EVENTS_EXCHANGE, ORDER_PLACED_KEY, body, {
      persistent: true, // delivery_mode=2: переживе рестарт брокера
      mandatory: true,
      messageId,
      contentType: 'application/json',
      ...extra,
    });
    await channel.waitForConfirms();
    // basic.return приходить ДО basic.ack для тієї ж публікації.
    if (this.returned.delete(messageId)) throw new UnroutableError(ORDER_PLACED_KEY);
  }

  async close(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
    this.channel = undefined;
    this.connection = undefined;
  }
}

/**
 * Nest-обгортка. Без BROKER_URL (e2e/інтеграційні тести, локальний запуск без брокера)
 * публікація вимкнена, а API працює як у ДЗ #18.
 */
@Injectable()
export class OrderEventsPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(OrderEventsPublisher.name);
  private readonly inner?: EventPublisher;

  constructor() {
    const url = process.env.BROKER_URL;
    if (url) this.inner = new EventPublisher(url);
    else this.logger.warn('BROKER_URL is not set: order.placed events are not published');
  }

  async publishOrderPlaced(event: OrderPlacedEvent): Promise<void> {
    if (!this.inner) return;
    try {
      await this.inner.publish(event);
    } catch (err) {
      // Замовлення вже закомічене в Postgres, а брокер недоступний: це dual write.
      // Замовлення не відкочуємо; це закриває transactional outbox (ДЗ #22).
      this.logger.error(`order.placed ${event.eventId} was not published: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.inner?.close();
  }
}
