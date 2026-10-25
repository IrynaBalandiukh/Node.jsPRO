# Оптимізації дата-шару — ДЗ №3 курсового проєкту

Виміряно на: `postgres:16-alpine`, після `db/schema.sql` → `db/seed.sql`
(110 000 `orders`, 120 000 `products`, 20 000 `users`, ~161 000 `order_items`).
Цикл прогнано так:

```
docker compose up -d --wait
npm run db:schema
npm run db:seed          # закінчується VACUUM (ANALYZE)
# EXPLAIN (ANALYZE, BUFFERS) "до" — нижче
npm run db:indexes
ANALYZE;
# EXPLAIN (ANALYZE, BUFFERS) "після" — нижче
```

Кожен запит виконувався як `EXPLAIN (ANALYZE, BUFFERS) <q*.sql>` через
`psql -U marketplace_app -d marketplace`. Числа — з цієї машини; орієнтир для
порівняння — порядок величини, а не конкретні мілісекунди.

> **Примітка про q3 «до».** Унікальний індекс `idx_users_email_lower`
> оголошений у `db/schema.sql` (він ще й гарантує унікальність email), тому на
> свіжій базі він існує одразу. Щоб зняти замір «до», я вручну виконала
> `DROP INDEX idx_users_email_lower;`, а «після» — `npm run db:indexes`:
> `db/indexes.sql` містить `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ...`
> і створює індекс знову.

## q1 — замовлення власника за період

Запит: `orders` за `buyer_id` + `created_at >= now() - 90 днів`,
відсортовані за датою. Реальний ендпоінт: історія замовлень конкретного
покупця.

### До індексів

```
Limit  (cost=4061.02..4061.03 rows=3 width=30) (actual time=4.356..4.358 rows=2 loops=1)
  Buffers: shared hit=1864
  ->  Sort  (cost=4061.02..4061.03 rows=3 width=30) (actual time=4.355..4.356 rows=2 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1864
        ->  Seq Scan on orders  (cost=0.00..4061.00 rows=3 width=30) (actual time=1.343..4.315 rows=2 loops=1)
              Filter: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
              Rows Removed by Filter: 109998
              Buffers: shared hit=1861
Planning:
  Buffers: shared hit=97
Planning Time: 0.436 ms
Execution Time: 4.440 ms
```

### Після індексів

```
Limit  (cost=16.18..16.18 rows=3 width=30) (actual time=0.058..0.058 rows=2 loops=1)
  Buffers: shared hit=11
  ->  Sort  (cost=16.18..16.18 rows=3 width=30) (actual time=0.057..0.057 rows=2 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=11
        ->  Bitmap Heap Scan on orders  (cost=4.45..16.15 rows=3 width=30) (actual time=0.032..0.037 rows=2 loops=1)
              Recheck Cond: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
              Heap Blocks: exact=2
              Buffers: shared hit=8
              ->  Bitmap Index Scan on idx_orders_buyer_created  (cost=0.00..4.45 rows=3 width=0) (actual time=0.025..0.025 rows=2 loops=1)
                    Index Cond: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
                    Buffers: shared hit=6
Planning:
  Buffers: shared hit=138
Planning Time: 0.628 ms
Execution Time: 0.104 ms
```

**Що змінилось:** `Seq Scan on orders` (прочитано всю таблицю: 110 000 рядків,
1861 buffers) замінився на `Bitmap Index Scan using idx_orders_buyer_created`
(складений індекс `(buyer_id, created_at)`) + `Bitmap Heap Scan`. Buffers:
1864 → 11, Execution Time: 4.44 мс → 0.10 мс (~43×).

## q2 — панель «замовлення в очікуванні»

Запит: `orders` зі `status = 'pending'`, найновіші перші, `LIMIT 50`.
Реальний ендпоінт: дашборд — що обробити зараз.

### До індексів

```
Limit  (cost=3981.21..3981.33 rows=50 width=32) (actual time=7.888..7.892 rows=50 loops=1)
  Buffers: shared hit=1864
  ->  Sort  (cost=3981.21..4037.29 rows=22433 width=32) (actual time=7.886..7.888 rows=50 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 30kB
        Buffers: shared hit=1864
        ->  Seq Scan on orders  (cost=0.00..3236.00 rows=22433 width=32) (actual time=0.465..6.083 rows=22136 loops=1)
              Filter: (status = 'pending'::text)
              Rows Removed by Filter: 87864
              Buffers: shared hit=1861
Planning:
  Buffers: shared hit=92
Planning Time: 0.407 ms
Execution Time: 7.926 ms
```

### Після індексів

```
Limit  (cost=0.29..18.62 rows=50 width=32) (actual time=0.013..0.109 rows=50 loops=1)
  Buffers: shared hit=52
  ->  Index Scan Backward using idx_orders_pending_created on orders  (cost=0.29..8024.55 rows=21886 width=32) (actual time=0.013..0.106 rows=50 loops=1)
        Buffers: shared hit=52
Planning:
  Buffers: shared hit=127
Planning Time: 0.565 ms
Execution Time: 0.128 ms
```

**Що змінилось:** `Seq Scan` (22 136 рядків `pending` + 87 864 відкинуто) і окреме
сортування (`top-N heapsort`) зникли. `idx_orders_pending_created` —
partial-індекс (`WHERE status = 'pending'`) по `created_at`, тож рядки в ньому
вже відсортовані, і план — просто `Index Scan Backward`, який зупиняється після
50 рядків. Buffers: 1864 → 52, Execution Time: 7.93 мс → 0.13 мс (~62×).

## q3 — логін за email без урахування регістру

Запит: `users` за `lower(email) = lower(...)`. Реальний ендпоінт: логін,
де користувач міг ввести email у довільному регістрі.

### До індексів

(`idx_users_email_lower` на момент заміру видалений — див. примітку вгорі.)

```
Seq Scan on users  (cost=0.00..567.00 rows=100 width=35) (actual time=1.120..4.253 rows=1 loops=1)
  Filter: (lower(email) = 'user4821@example.com'::text)
  Rows Removed by Filter: 19999
  Buffers: shared hit=267
Planning:
  Buffers: shared hit=66
Planning Time: 0.332 ms
Execution Time: 4.276 ms
```

### Після індексів

```
Index Scan using idx_users_email_lower on users  (cost=0.29..8.30 rows=1 width=35) (actual time=0.017..0.017 rows=1 loops=1)
  Index Cond: (lower(email) = 'user4821@example.com'::text)
  Buffers: shared hit=3
Planning:
  Buffers: shared hit=91
Planning Time: 0.442 ms
Execution Time: 0.044 ms
```

**Що змінилось:** звичайний `UNIQUE (email)` тут марний — предикат по
`lower(email)`, а не по `email` (і до того ж пропускав дублікати за регістром:
`A@x.com` і `a@x.com`). Тому використано унікальний expression-індекс
`idx_users_email_lower ON users (lower(email))` (оголошений у `db/schema.sql`,
повторно створюється в `db/indexes.sql` через `IF NOT EXISTS`); він одночасно
гарантує унікальність і обслуговує q3. `Seq Scan` (19 999 рядків відфільтровано
вручну) замінився на `Index Scan`. Buffers: 267 → 3, Execution Time: 4.28 мс →
0.04 мс (~97×).

## q4 — повнотекстовий пошук по каталогу

Запит: `products` за `plainto_tsquery('simple', 'шкіряні кросівки')`,
`ORDER BY ts_rank(...) DESC`, `LIMIT 20`. Збігів — 3029 з 120 000 рядків
(2.5 %), тобто одиниці відсотків каталогу.

### До індексів

```
Limit  (cost=7416.83..7416.88 rows=20 width=39) (actual time=13.489..13.491 rows=20 loops=1)
  Buffers: shared hit=5918
  ->  Sort  (cost=7416.83..7417.25 rows=166 width=39) (actual time=13.488..13.488 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=5918
        ->  Seq Scan on products  (cost=0.00..7412.41 rows=166 width=39) (actual time=0.015..13.113 rows=3029 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 116971
              Buffers: shared hit=5912
Planning:
  Buffers: shared hit=96
Planning Time: 0.462 ms
Execution Time: 13.523 ms
```

### Після індексів

```
Limit  (cost=589.59..589.64 rows=20 width=39) (actual time=3.906..3.910 rows=20 loops=1)
  Buffers: shared hit=2401
  ->  Sort  (cost=589.59..589.96 rows=151 width=39) (actual time=3.905..3.907 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2401
        ->  Bitmap Heap Scan on products  (cost=54.98..585.57 rows=151 width=39) (actual time=0.806..3.567 rows=3029 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=2387
              Buffers: shared hit=2395
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..54.94 rows=151 width=0) (actual time=0.582..0.583 rows=3029 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=8
Planning:
  Buffers: shared hit=121
Planning Time: 0.561 ms
Execution Time: 3.974 ms
```

**Що змінилось:** `Seq Scan` (116 971 рядків відкинуто вручну) замінився на
`Bitmap Index Scan using idx_products_search_vector` (GIN по `search_vector`) +
`Bitmap Heap Scan`. Сам `Bitmap Index Scan` коштує лише 8 buffers — основна
вартість тепер у `Heap Blocks: exact=2387`: треба дістати з таблиці самі 3029
рядків-збігів (GIN лише каже, де вони), а потім відсортувати їх за `ts_rank`.
Buffers: 5918 → 2401, Execution Time: 13.5 мс → 3.97 мс (~3.4×). Приріст
менший, ніж у q1–q3, бо запит повертає 2.5 % таблиці, і ці рядки все одно
треба прочитати.

## Морфологія

`search_vector` побудовано на конфігурації `'simple'`
(`to_tsvector('simple', name || ' ' || coalesce(description, ''))`). На відміну
від мовних конфігів зі стемінгом, `'simple'` **не стемить** — кожна словоформа
стає окремою лексемою:

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
-- 6053
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');
-- 0
```

**Кросівки** (називний відмінок множини) дає 6053 збігів; **кросівок**
(родовий відмінок множини) — 0, хоча семантично це те саме слово.
Причина: `'simple'` лише нормалізує регістр і розбиває текст на слова, без
морфологічного аналізу, тому `кросівки` і `кросівок` стають двома різними,
ніяк не пов'язаними лексемами. Це не баг і не те, що можна «полагодити»
індексом — щоб пошук працював по відмінках, потрібен словник з українською
морфологією (наприклад, `hunspell`/`ispell`-словник для `uk`), а не заміна
`'simple'` на `'russian'` — це інша мова з іншою граматикою.

## Чого немає: індекс на `order_items (order_id)`

Postgres не створює індекс на FK автоматично, тож `order_items.order_id` без
нього читається через Seq Scan (це також стосується `ON DELETE CASCADE` при
видаленні замовлення). Однак жоден із запитів q1–q4 не шукає позиції за
замовленням, і після прогону перевірка `pg_stat_user_indexes` показала для
такого індексу `idx_scan = 0`. Невикористаний індекс лише сповільнює кожен
`INSERT`/`UPDATE`/`DELETE` і займає місце, тому я його не створюю. Додам
`CREATE INDEX ON order_items (order_id)` разом із першим запитом, що читає
позиції за замовленням (наприклад, `GET /orders/:id`).
