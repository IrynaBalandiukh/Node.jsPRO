import { MigrationInterface, QueryRunner } from "typeorm";

// Buyer balance (debited in checkout) and the jobs queue for the worker pool
// (FOR UPDATE SKIP LOCKED). The schema is changed by migrations only.
export class ConcurrencyLayer1790200000000 implements MigrationInterface {
    name = 'ConcurrencyLayer1790200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Money is an integer in cents; the CHECK keeps the balance non-negative
        // even if a check is forgotten in code.
        await queryRunner.query(`ALTER TABLE "users" ADD "balance_cents" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "CHK_users_balance_non_negative" CHECK ("balance_cents" >= 0)`);

        await queryRunner.query(`CREATE TABLE "jobs" (
            "id" BIGSERIAL NOT NULL,
            "kind" text NOT NULL,
            "payload" jsonb NOT NULL DEFAULT '{}',
            "status" text NOT NULL DEFAULT 'pending',
            "processed" integer NOT NULL DEFAULT 0,
            "worker_id" text,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "processed_at" TIMESTAMP WITH TIME ZONE,
            CONSTRAINT "CHK_jobs_status" CHECK ("status" IN ('pending', 'done')),
            CONSTRAINT "CHK_jobs_processed" CHECK ("processed" >= 0),
            CONSTRAINT "PK_jobs_id" PRIMARY KEY ("id"))`);
        // Partial index: workers look only for pending jobs, so the index does
        // not grow with the history of finished ones.
        await queryRunner.query(`CREATE INDEX "idx_jobs_pending" ON "jobs" ("id") WHERE "status" = 'pending'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_jobs_pending"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_balance_non_negative"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
    }
}
