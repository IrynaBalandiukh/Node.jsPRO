import { Entity, PrimaryColumn, Column, CreateDateColumn, Unique } from 'typeorm';

// Ефект споживача order.placed (HW19). event_id — PK, order_id — UNIQUE: INSERT … ON CONFLICT
// DO NOTHING робить повторну доставку тієї самої події безпечною. Constraint names match the
// migration FulfillmentTasks1790400000000.
@Entity({ name: 'fulfillment_tasks' })
@Unique('UQ_fulfillment_tasks_order_id', ['orderId'])
export class FulfillmentTask {
  @PrimaryColumn({ name: 'event_id', type: 'uuid', primaryKeyConstraintName: 'PK_fulfillment_tasks_event_id' })
  eventId!: string;

  @Column({ name: 'order_id', type: 'text' })
  orderId!: string;

  @Column({ name: 'total_cents', type: 'bigint' })
  totalCents!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
