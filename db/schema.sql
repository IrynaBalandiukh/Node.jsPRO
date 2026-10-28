-- Marketplace API — data-layer schema (course project, HW #3).
-- Applies to a clean database with a single command:
--   psql "$DATABASE_URL" -f db/schema.sql

BEGIN;

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('buyer', 'seller')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Email uniqueness is case-insensitive: 'A@x.com' and 'a@x.com' are the
-- same user. This is also the expression index that q3 relies on
-- (WHERE lower(email) = ...), so a separate plain UNIQUE(email) is not needed.
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint NOT NULL REFERENCES users (id),
  name        text NOT NULL,
  description text,
  -- Money is whole cents (integer), not numeric/float — same as
  -- price_cents in the OpenAPI contract.
  price_cents integer NOT NULL CHECK (price_cents > 0),
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  photos      text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Generated column: needs no manual upkeep on INSERT or UPDATE.
  -- Its GIN index lives separately, in db/indexes.sql.
  -- description is optional (as in the contract), hence coalesce.
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || coalesce(description, ''))) STORED
);

CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id     bigint NOT NULL REFERENCES users (id),
  status       text NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
  total_cents  bigint NOT NULL CHECK (total_cents >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents > 0)
);

-- NOTE: no index on order_items (order_id) on purpose. PostgreSQL does not
-- create one for a FK automatically, so DELETE FROM orders (ON DELETE CASCADE)
-- and "items of order X" lookups would Seq Scan order_items. None of q1-q4
-- uses such a lookup yet, and an unused index only slows down every
-- INSERT/UPDATE/DELETE. Add CREATE INDEX ON order_items (order_id) together
-- with the first query that reads items by order.

COMMIT;
