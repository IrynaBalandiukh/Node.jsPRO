import { MigrationInterface, QueryRunner } from "typeorm";

// ДЗ №14: баланс покупця (списується в checkout) і черга задач (jobs) для
// воркер-пулу на FOR UPDATE SKIP LOCKED. Схему міняє лише міграція.
export class ConcurrencyLayer1790200000000 implements MigrationInterface {
    name = 'ConcurrencyLayer1790200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Гроші — integer у копійках; CHECK гарантує, що баланс не піде в мінус
        // навіть якщо десь забудуть перевірку в коді.
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
        // Часткові індекси: воркери шукають лише pending, тож індекс не росте
        // разом з історією виконаних задач.
        await queryRunner.query(`CREATE INDEX "idx_jobs_pending" ON "jobs" ("id") WHERE "status" = 'pending'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_jobs_pending"`);
        await queryRunner.query(`DROP TABLE "jobs"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_balance_non_negative"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
    }
}
