import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1790089957055 implements MigrationInterface {
    name = 'InitSchema1790089957055'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "orders" ("id" BIGSERIAL NOT NULL, "status" text NOT NULL, "total_amount_cents" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "buyer_id" bigint NOT NULL, CONSTRAINT "CHK_48a96b12a825f3b12da22948f1" CHECK ("total_amount_cents" >= 0), CONSTRAINT "CHK_c6ee4aaed03072170334b9665d" CHECK ("status" IN ('pending', 'paid', 'cancelled')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_orders_buyer_created" ON "orders" ("buyer_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" BIGSERIAL NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, CONSTRAINT "CHK_1228f2a7264bfeb7b34e5db1bc" CHECK ("unit_price_cents" > 0), CONSTRAINT "CHK_6e5d794f7711186091b3156024" CHECK ("quantity" > 0), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_order_items_order_id" ON "order_items" ("order_id") `);
        await queryRunner.query(`CREATE INDEX "idx_order_items_product_id" ON "order_items" ("product_id") `);
        await queryRunner.query(`CREATE TABLE "products" ("id" BIGSERIAL NOT NULL, "name" text NOT NULL, "description" text NOT NULL, "price_cents" integer NOT NULL, "stock" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "seller_id" bigint NOT NULL, CONSTRAINT "CHK_aea3ee263e1d44e36e5f5b5783" CHECK ("stock" >= 0), CONSTRAINT "CHK_1a2c66353c6fcc8b7857b7ac65" CHECK ("price_cents" > 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_products_seller_id" ON "products" ("seller_id") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" BIGSERIAL NOT NULL, "email" text NOT NULL, "password_hash" text NOT NULL, "role" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "CHK_d3f6c6c9186422525e27964c89" CHECK ("role" IN ('buyer', 'seller', 'admin')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email") `);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        // Ручна правка згенерованої міграції (ДЗ №13): два індекси з
        // db/indexes.sql (ДЗ №3), які @Index-декоратор не вміє виразити —
        // партціальний і expression-індекс. Генератор про них не знає,
        // бо диффить лише прості колонки/унікальність entity.
        //
        // idx_orders_pending_created: панель "замовлення в очікуванні" —
        // тільки status = 'pending', завжди відсортовані за created_at.
        await queryRunner.query(
            `CREATE INDEX "idx_orders_pending_created" ON "orders" ("created_at") WHERE "status" = 'pending'`,
        );
        // idx_users_email_lower: логін за email без урахування регістру —
        // WHERE lower(email) = ... не може скористатись звичайним UNIQUE(email).
        await queryRunner.query(`CREATE INDEX "idx_users_email_lower" ON "users" (lower("email"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."idx_users_email_lower"`);
        await queryRunner.query(`DROP INDEX "public"."idx_orders_pending_created"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_425ee27c69d6b8adc5d6475dcfe"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_5e90e93d0e036c3fadbaefa4d0a"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."idx_products_seller_id"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP INDEX "public"."idx_order_items_product_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_order_items_order_id"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP INDEX "public"."idx_orders_buyer_created"`);
        await queryRunner.query(`DROP TABLE "orders"`);
    }

}
