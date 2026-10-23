-- Marketplace API — realistic data volume (course project, HW #3).
-- Run right after db/schema.sql, against a clean (freshly created) schema:
--   psql "$DATABASE_URL" -f db/seed.sql
--
-- Distributions are deliberately skewed (not 33/33/33): most users are
-- buyers, most orders are paid, products with zero stock are a
-- minority. The catalog (name/description) is in Ukrainian: q3
-- (case-insensitive) and q4 (full-text search) are built on it.
--
-- Every helper LATERAL subselect below deliberately contains "WHERE <outer>.i
-- IS NOT NULL" — a tautology with no logical effect, but it forces the
-- planner to treat the subquery as truly correlated with the outer row.
-- Without it PostgreSQL sees that the subquery does not depend on outer columns,
-- and is allowed to evaluate random() once and reuse the same
-- result for every row — over 120 000 rows that looks not like a bug,
-- but like one product/one role duplicated many times.

BEGIN;

-- 1) Users: 90% buyer, 10% seller.
INSERT INTO users (email, password_hash, role)
SELECT
  'user' || i || '@example.com',
  md5(random()::text || i::text),
  CASE
    WHEN r < 0.90 THEN 'buyer'
    ELSE 'seller'
  END
FROM generate_series(1, 20000) AS s (i)
CROSS JOIN LATERAL (SELECT random() AS r WHERE s.i IS NOT NULL) rnd;

-- 2) Products: >=100 000 rows, Ukrainian name/description, skewed categories,
-- price, stock and activity. "Кросівки" + "шкіряні" deliberately overlap in
-- only ~2-3% of the catalog — this is the word pair searched in q4.
WITH sellers AS (
  SELECT array_agg(id) AS ids FROM users WHERE role = 'seller'
)
INSERT INTO products (seller_id, name, description, price_cents, stock, is_active)
SELECT
  sellers.ids[1 + floor(random() * array_length(sellers.ids, 1))::int],
  g.cat || ' ' || g.brand || ' р.' || g.size_num,
  g.description,
  (500 + floor(random() * 49500))::int,
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

-- 3) Orders: >=100 000 rows. Statuses are skewed (paid is the most common),
-- creation date is skewed toward the recent past (^3 distribution).
INSERT INTO orders (buyer_id, status, total_cents, created_at)
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

-- 4) Order items: 1-4 per order (mostly 1), quantity mostly 1.
INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
SELECT
  o.id,
  products.ids[1 + floor(random() * array_length(products.ids, 1))::int],
  CASE
    WHEN random() < 0.75 THEN 1
    WHEN random() < 0.93 THEN 2
    ELSE (3 + floor(random() * 3))::int
  END,
  (500 + floor(random() * 49500))::int
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

-- 5) An order's total_cents = the sum of its items.
UPDATE orders o
SET total_cents = sub.total
FROM (
  SELECT order_id, sum(quantity * unit_price_cents) AS total
  FROM order_items
  GROUP BY order_id
) sub
WHERE o.id = sub.order_id;

COMMIT;

-- VACUUM cannot run inside a transaction — run it separately, after COMMIT.
-- It sets the visibility map: without it Index Only Scan still goes to the
-- table (Heap Fetches in the plan), and the "after" buffers are orders of magnitude worse.
VACUUM (ANALYZE);
