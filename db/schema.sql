-- Marketplace API — data-layer schema (ДЗ №3 курсового проєкту).
-- Застосовується на чисту базу однією командою:
--   psql "$DATABASE_URL" -f db/schema.sql

BEGIN;

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('buyer', 'seller', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id   bigint NOT NULL REFERENCES users (id),
  name        text NOT NULL,
  description text NOT NULL,
  price       numeric(10, 2) NOT NULL CHECK (price > 0),
  stock       integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Генерована колонка: не потребує підтримки руками ні на INSERT, ні на
  -- UPDATE. Індекс під неї (GIN) живе окремо, у db/indexes.sql.
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED
);

CREATE TABLE orders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id     bigint NOT NULL REFERENCES users (id),
  status       text NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
  total_amount numeric(12, 2) NOT NULL CHECK (total_amount >= 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products (id),
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(10, 2) NOT NULL CHECK (unit_price > 0)
);

COMMIT;
