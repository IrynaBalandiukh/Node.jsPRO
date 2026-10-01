-- Marketplace API — мінімальний набір індексів, що лікує всі чотири запити
-- (ДЗ №3 курсового проєкту). Кожен індекс закриває рівно один запит — жоден
-- не лишається мертвим (перевіряється через pg_stat_user_indexes).
--
--   psql "$DATABASE_URL" -f db/indexes.sql
--   psql "$DATABASE_URL" -c "ANALYZE;"

-- q1: пошук замовлень за власником (buyer_id) + періодом (created_at).
CREATE INDEX idx_orders_buyer_created ON orders (buyer_id, created_at);

-- q2: панель "замовлення в очікуванні" — тільки status = 'pending', завжди
-- відсортовані за created_at. Partial-індекс: для інших статусів (paid,
-- cancelled) цей індекс узагалі не існує на диску.
CREATE INDEX idx_orders_pending_created ON orders (created_at) WHERE status = 'pending';

-- q3: логін за email без урахування регістру. Expression-індекс: WHERE
-- lower(email) = ... не може скористатись звичайним UNIQUE(email).
CREATE INDEX idx_users_email_lower ON users (lower(email));

-- q4: повнотекстовий пошук по каталогу. GIN по tsvector — не B-tree.
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
