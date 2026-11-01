import { MigrationInterface, QueryRunner } from "typeorm";

// HW19: the effect of the order.placed consumer. event_id is the idempotency key.
export class FulfillmentTasks1790400000000 implements MigrationInterface {
    name = 'FulfillmentTasks1790400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "fulfillment_tasks" ("event_id" uuid NOT NULL, "order_id" text NOT NULL, "total_cents" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_fulfillment_tasks_order_id" UNIQUE ("order_id"), CONSTRAINT "PK_fulfillment_tasks_event_id" PRIMARY KEY ("event_id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "fulfillment_tasks"`);
    }
}
