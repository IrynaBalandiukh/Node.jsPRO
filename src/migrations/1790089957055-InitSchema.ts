import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1790089957055 implements MigrationInterface {
    name = 'InitSchema1790089957055'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "email" text NOT NULL, "password_hash" text NOT NULL, "role" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_users_role" CHECK ("role" IN ('buyer', 'seller')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "name" text NOT NULL, "description" text, "price_cents" integer NOT NULL, "stock" integer NOT NULL DEFAULT '0', "photos" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "seller_id" bigint NOT NULL, CONSTRAINT "chk_products_stock_nonneg" CHECK ("stock" >= 0), CONSTRAINT "chk_products_price_positive" CHECK ("price_cents" > 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" BIGSERIAL NOT NULL, "status" text NOT NULL, "total_cents" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "buyer_id" bigint NOT NULL, CONSTRAINT "chk_orders_total_nonneg" CHECK ("total_cents" >= 0), CONSTRAINT "chk_orders_status" CHECK ("status" IN ('pending', 'paid', 'cancelled')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" BIGSERIAL NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, CONSTRAINT "chk_order_items_unit_price_positive" CHECK ("unit_price_cents" > 0), CONSTRAINT "chk_order_items_quantity_positive" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_orders_buyer_created" ON "orders" ("buyer_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // Hand-written part: the expression index below cannot be declared with
        // @Index, and the generator does not know about it. The partial index is
        // declared in order.entity.ts as well.
        //
        // Case-insensitive unique email: 'A@x.com' and 'a@x.com' are one user.
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email_lower" ON "users" (lower("email"))`);
        // Partial index for the "pending orders" panel: only status = 'pending',
        // already ordered by created_at.
        await queryRunner.query(`CREATE INDEX "idx_orders_pending_created" ON "orders" ("created_at") WHERE "status" = 'pending'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_orders_pending_created"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_email_lower"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe"`);
        await queryRunner.query(`DROP INDEX "public"."idx_orders_buyer_created"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
