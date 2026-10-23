-- Marketplace API — the minimal set of indexes that fixes all four queries
-- (course project, HW #3). Each index covers exactly one query — none is
-- left dead (checked via pg_stat_user_indexes).
--
--   psql "$DATABASE_URL" -f db/indexes.sql
--   psql "$DATABASE_URL" -c "ANALYZE;"

-- q1: look up orders by owner (buyer_id) + period (created_at).
CREATE INDEX idx_orders_buyer_created ON orders (buyer_id, created_at);

-- q2: "pending orders" dashboard — only status = 'pending', always
-- sorted by created_at. Partial index: for other statuses (paid,
-- cancelled) this index does not exist on disk at all.
CREATE INDEX idx_orders_pending_created ON orders (created_at) WHERE status = 'pending';

-- q3: case-insensitive login by email. The expression index
-- idx_users_email_lower (UNIQUE on lower(email)) is declared in db/schema.sql —
-- it also enforces uniqueness. IF NOT EXISTS makes this a no-op on a normal
-- setup, and recreates the index if it was dropped (e.g. for the "before" EXPLAIN).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));

-- q4: full-text search over the catalog. GIN on tsvector — not a B-tree.
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
