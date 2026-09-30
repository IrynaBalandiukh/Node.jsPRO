-- Marketplace API — реалістичний обсяг даних (ДЗ №3 курсового проєкту).
-- Запускається одразу після db/schema.sql, на чисту (щойно створену) схему:
--   psql "$DATABASE_URL" -f db/seed.sql
--
-- Розподіли навмисно перекошені (не 33/33/33): більшість користувачів —
-- покупці, більшість замовлень — оплачені, товари з нульовим залишком —
-- меншість. Каталог (name/description) — українською: саме на ньому
-- побудовано q3 (case-insensitive) і q4 (повнотекстовий пошук).
--
-- Кожна допоміжна LATERAL-підвибірка нижче навмисно містить "WHERE <outer>.i
-- IS NOT NULL" — тавтологія, яка ні на що не впливає логічно, але змушує
-- планувальник вважати підзапит справді корельованим із зовнішнім рядком.
-- Без цього PostgreSQL бачить, що підзапит не залежить від зовнішніх стовпців,
-- і має право обчислити random() один раз і повторно використати той самий
-- результат для всіх рядків — на 120 000 рядків це виглядає не як помилка,
-- а як один товар/одна роль, розмножені копіями.

BEGIN;

-- 1) Користувачі: 90% buyer, 8% seller, 2% admin.
INSERT INTO users (email, password_hash, role)
SELECT
  'user' || i || '@example.com',
  md5(random()::text || i::text),
  CASE
    WHEN r < 0.90 THEN 'buyer'
    WHEN r < 0.98 THEN 'seller'
    ELSE 'admin'
  END
FROM generate_series(1, 20000) AS s (i)
CROSS JOIN LATERAL (SELECT random() AS r WHERE s.i IS NOT NULL) rnd;

-- 2) Товари: >=100 000 рядків, українські назва/опис, перекошені категорії,
-- ціна, залишок і активність. "Кросівки" + "шкіряні" навмисно перетинаються
-- лише в ~2-3% каталогу — саме ця пара слів шукається в q4.
WITH sellers AS (
  SELECT array_agg(id) AS ids FROM users WHERE role = 'seller'
)
INSERT INTO products (seller_id, name, description, price, stock, is_active)
SELECT
  sellers.ids[1 + floor(random() * array_length(sellers.ids, 1))::int],
  g.cat || ' ' || g.brand || ' р.' || g.size_num,
  g.description,
  round((5 + random() * 495)::numeric, 2),
  CASE WHEN random() < 0.05 THEN 0 ELSE floor(random() * 200)::int END,
  random() < 0.95
FROM generate_series(1, 120000) AS s (i)
CROSS JOIN sellers
CROSS JOIN LATERAL (
  SELECT
    picked.cat,
    picked.brand,
    picked.color,
    picked.size_num,
    CASE
      WHEN picked.cat = 'Кросівки' AND picked.is_leather THEN
        'Стильні шкіряні кросівки для щоденного носіння, розмір '
          || picked.size_num || ', колір ' || picked.color || '.'
      ELSE
        'Якісний товар: ' || picked.cat || ' від ' || picked.brand
          || ', колір ' || picked.color || ', розмір ' || picked.size_num || '.'
    END AS description
  FROM (
    SELECT
      CASE
        WHEN r < 0.20 THEN 'Футболка'
        WHEN r < 0.32 THEN 'Джинси'
        WHEN r < 0.37 THEN 'Кросівки'
        WHEN r < 0.45 THEN 'Сумка'
        WHEN r < 0.48 THEN 'Ноутбук'
        WHEN r < 0.52 THEN 'Смартфон'
        WHEN r < 0.62 THEN 'Куртка'
        WHEN r < 0.77 THEN 'Книга'
        WHEN r < 0.87 THEN 'Іграшка'
        WHEN r < 0.93 THEN 'Годинник'
        ELSE 'Навушники'
      END AS cat,
      (ARRAY['Nike', 'Adidas', 'Zara', 'Xiaomi', 'Samsung', 'Local', 'NoName', 'Reebok', 'Lenovo', 'Puma'])
        [1 + floor(random() * 10)::int] AS brand,
      (ARRAY['чорний', 'білий', 'синій', 'червоний', 'сірий', 'зелений'])
        [1 + floor(random() * 6)::int] AS color,
      (36 + floor(random() * 12))::int AS size_num,
      (random() < 0.5) AS is_leather
    FROM (SELECT random() AS r WHERE s.i IS NOT NULL) rr
  ) picked
) g;

-- 3) Замовлення: >=100 000 рядків. Статуси перекошені (paid найчастіший),
-- дата створення перекошена в бік недавнього минулого (розподіл ^3).
INSERT INTO orders (buyer_id, status, total_amount, created_at)
SELECT
  buyers.ids[1 + floor(random() * array_length(buyers.ids, 1))::int],
  CASE
    WHEN r < 0.70 THEN 'paid'
    WHEN r < 0.90 THEN 'pending'
    ELSE 'cancelled'
  END,
  0,
  now() - (random() ^ 3) * interval '730 days'
FROM generate_series(1, 110000) AS s (i)
CROSS JOIN (SELECT array_agg(id) AS ids FROM users WHERE role = 'buyer') buyers
CROSS JOIN LATERAL (SELECT random() AS r WHERE s.i IS NOT NULL) rnd;

-- 4) Позиції замовлень: 1-4 на замовлення (переважно 1), кількість переважно 1.
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  o.id,
  products.ids[1 + floor(random() * array_length(products.ids, 1))::int],
  CASE
    WHEN random() < 0.75 THEN 1
    WHEN random() < 0.93 THEN 2
    ELSE (3 + floor(random() * 3))::int
  END,
  round((5 + random() * 495)::numeric, 2)
FROM orders o
CROSS JOIN (SELECT array_agg(id) AS ids FROM products) products
CROSS JOIN LATERAL (
  SELECT generate_series(
    1,
    CASE
      WHEN random() < 0.6 THEN 1
      WHEN random() < 0.85 THEN 2
      WHEN random() < 0.95 THEN 3
      ELSE 4
    END
  ) AS item_no
  WHERE o.id IS NOT NULL
) items;

-- 5) total_amount замовлення = сума його позицій.
UPDATE orders o
SET total_amount = sub.total
FROM (
  SELECT order_id, sum(quantity * unit_price) AS total
  FROM order_items
  GROUP BY order_id
) sub
WHERE o.id = sub.order_id;

COMMIT;

-- VACUUM не можна виконувати всередині транзакції — окремо, після COMMIT.
-- Виставляє visibility map: без цього Index Only Scan усе одно лазить у
-- таблицю (Heap Fetches у плані), і buffers "після" будуть на порядки гірші.
VACUUM (ANALYZE);
