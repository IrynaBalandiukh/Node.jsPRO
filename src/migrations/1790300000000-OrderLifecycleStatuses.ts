import { MigrationInterface, QueryRunner } from "typeorm";

// Orders get a life cycle after payment: processing, shipped, delivered.
// Only the CHECK constraint changes (status is a text column).
export class OrderLifecycleStatuses1790300000000 implements MigrationInterface {
    name = 'OrderLifecycleStatuses1790300000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "chk_orders_status"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_status" CHECK ("status" IN ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // The old constraint does not know the new statuses: they fall back to paid.
        await queryRunner.query(`UPDATE "orders" SET "status" = 'paid' WHERE "status" IN ('processing', 'shipped', 'delivered')`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "chk_orders_status"`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_status" CHECK ("status" IN ('pending', 'paid', 'cancelled'))`);
    }
}
