# Оптимізації дата-шару — ДЗ №3 курсового проєкту

Виміряно на: `postgres:16-alpine`, чистий volume, після `db/schema.sql` →
`db/seed.sql` (110 000 `orders`, 120 000 `products`, 160 750 `order_items`,
20 000 `users`). Цикл прогнано рівно так, як його прожене грейдер:

```
docker compose down -v && docker compose up -d --wait
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql        # закінчується VACUUM (ANALYZE)
# EXPLAIN "до" — нижче
psql "$DATABASE_URL" -f db/indexes.sql
psql "$DATABASE_URL" -c "ANALYZE;"
# EXPLAIN "після" — нижче
```

Числа — з цієї машини; орієнтир для порівняння — порядок величини
(десятки разів), а не конкретні мілісекунди.

## q1 — замовлення власника за період

Запит: `orders` за `buyer_id` + `created_at >= now() - 90 днів`,
відсортовані за датою, `LIMIT 50`. Реальний ендпоінт: історія замовлень
конкретного покупця.

### До індексів

```
Limit  (cost=3974.02..3974.03 rows=3 width=28) (actual time=7.628..7.631 rows=4 loops=1)
  Buffers: shared hit=1777
  ->  Sort  (cost=3974.02..3974.03 rows=3 width=28) (actual time=7.625..7.627 rows=4 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1777
        ->  Seq Scan on orders  (cost=0.00..3974.00 rows=3 width=28) (actual time=0.913..7.549 rows=4 loops=1)
              Filter: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
              Rows Removed by Filter: 109996
              Buffers: shared hit=1774
Planning:
  Buffers: shared hit=97
Planning Time: 0.841 ms
Execution Time: 7.698 ms
```

### Після індексів

```
Limit  (cost=16.17..16.17 rows=3 width=28) (actual time=0.147..0.149 rows=4 loops=1)
  Buffers: shared hit=10 read=3
  ->  Sort  (cost=16.17..16.17 rows=3 width=28) (actual time=0.145..0.146 rows=4 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=10 read=3
        ->  Bitmap Heap Scan on orders  (cost=4.45..16.14 rows=3 width=28) (actual time=0.075..0.114 rows=4 loops=1)
              Recheck Cond: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
              Heap Blocks: exact=4
              Buffers: shared hit=7 read=3
              ->  Bitmap Index Scan on idx_orders_buyer_created  (cost=0.00..4.45 rows=3 width=0) (actual time=0.061..0.061 rows=4 loops=1)
                    Index Cond: ((buyer_id = 4821) AND (created_at >= (now() - '90 days'::interval)))
                    Buffers: shared hit=3 read=3
Planning:
  Buffers: shared hit=134 read=2
Planning Time: 1.214 ms
Execution Time: 0.232 ms
```

**Що змінилось:** `Seq Scan on orders` (110 000 рядків прочитано, 1774
buffers) зник, замість нього — `Bitmap Index Scan using idx_orders_buyer_created`
+ `Bitmap Heap Scan`. Buffers впали з 1777 до 10 (переважно hit — сторінки
вже в кеші), Execution Time — з 7.7 мс до 0.23 мс (~33×).

## q2 — панель "замовлення в очікуванні"

Запит: `orders` зі `status = 'pending'`, найновіші перші, `LIMIT 50`.
Реальний ендпоінт: дашборд продавця/адміна — що обробити зараз.

### До індексів

```
Limit  (cost=3888.46..3888.59 rows=50 width=30) (actual time=13.025..13.033 rows=50 loops=1)
  Buffers: shared hit=1777
  ->  Sort  (cost=3888.46..3944.11 rows=22260 width=30) (actual time=13.023..13.027 rows=50 loops=1)
        Sort Key: created_at DESC
        Sort Method: top-N heapsort  Memory: 31kB
        Buffers: shared hit=1777
        ->  Seq Scan on orders  (cost=0.00..3149.00 rows=22260 width=30) (actual time=1.002..9.879 rows=22038 loops=1)
              Filter: (status = 'pending'::text)
              Rows Removed by Filter: 87962
              Buffers: shared hit=1774
Planning:
  Buffers: shared hit=92
Planning Time: 0.811 ms
Execution Time: 13.115 ms
```

### Після індексів

```
Limit  (cost=0.29..17.80 rows=50 width=30) (actual time=0.078..0.279 rows=50 loops=1)
  Buffers: shared hit=50 read=2
  ->  Index Scan Backward using idx_orders_pending_created on orders  (cost=0.29..7676.97 rows=21912 width=30) (actual time=0.076..0.272 rows=50 loops=1)
        Buffers: shared hit=50 read=2
Planning:
  Buffers: shared hit=125
Planning Time: 1.510 ms
Execution Time: 0.363 ms
```

**Що змінилось:** `Seq Scan` + окреме сортування (`top-N heapsort`) зникли —
`idx_orders_pending_created` (partial, `WHERE status = 'pending'`) уже
зберігає рядки відсортованими за `created_at`, тож план — просто
`Index Scan Backward`, без окремого Sort-вузла. Buffers: 1777 → 52,
Execution Time: 13.1 мс → 0.36 мс (~36×).

## q3 — логін за email без урахування регістру

Запит: `users` за `lower(email) = lower(...)`. Реальний ендпоінт: логін,
де користувач міг ввести email у довільному регістрі.

### До індексів

```
Seq Scan on users  (cost=0.00..567.00 rows=100 width=35) (actual time=1.809..7.831 rows=1 loops=1)
  Filter: (lower(email) = 'user4821@example.com'::text)
  Rows Removed by Filter: 19999
  Buffers: shared hit=267
Planning:
  Buffers: shared hit=84
Planning Time: 0.735 ms
Execution Time: 7.880 ms
```

### Після індексів

```
Index Scan using idx_users_email_lower on users  (cost=0.29..8.30 rows=1 width=35) (actual time=0.037..0.038 rows=1 loops=1)
  Index Cond: (lower(email) = 'user4821@example.com'::text)
  Buffers: shared hit=1 read=2
Planning:
  Buffers: shared hit=103 read=1
Planning Time: 0.928 ms
Execution Time: 0.082 ms
```

**Що змінилось:** звичайний `UNIQUE (email)` тут марний — предикат по
`lower(email)`, а не по `email`. Expression-індекс `idx_users_email_lower`
дав `Index Scan` замість `Seq Scan` по всій таблиці (19999 рядків
відфільтровано вручну). Buffers: 267 → 3, Execution Time: 7.9 мс → 0.08 мс
(~96×).

## q4 — повнотекстовий пошук по каталогу

Запит: `products` за `plainto_tsquery('simple', 'шкіряні кросівки')`,
`ORDER BY ts_rank(...) DESC`, `LIMIT 20`. Селективність — 2926 з 120 000
рядків (2.44 %), тобто одиниці відсотків каталогу, як і вимагалось.

### До індексів

```
Limit  (cost=7224.05..7224.10 rows=20 width=39) (actual time=22.790..22.795 rows=20 loops=1)
  Buffers: shared hit=5726
  ->  Sort  (cost=7224.05..7224.39 rows=139 width=39) (actual time=22.788..22.791 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=5726
        ->  Seq Scan on products  (cost=0.00..7220.35 rows=139 width=39) (actual time=0.219..22.153 rows=2926 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 117074
              Buffers: shared hit=5720
Planning:
  Buffers: shared hit=96
Planning Time: 0.998 ms
Execution Time: 22.858 ms
```

### Після індексів (3-й прогін — перший після `CREATE INDEX` холодний, GIN не в кеші)

```
Limit  (cost=565.10..565.15 rows=20 width=38) (actual time=6.146..6.150 rows=20 loops=1)
  Buffers: shared hit=2334
  ->  Sort  (cost=565.10..565.46 rows=144 width=38) (actual time=6.144..6.146 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=2334
        ->  Bitmap Heap Scan on products  (cost=54.94..561.27 rows=144 width=38) (actual time=1.232..5.621 rows=2926 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=2320
              Buffers: shared hit=2328
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..54.91 rows=144 width=0) (actual time=0.820..0.821 rows=2926 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=8
Planning:
  Buffers: shared hit=121
Planning Time: 0.933 ms
Execution Time: 6.243 ms
```

**Що змінилось:** `Seq Scan` (117 074 рядки відкинуто вручну) замінився на
`Bitmap Index Scan using idx_products_search_vector` (GIN по `search_vector`)
+ `Bitmap Heap Scan`. `Bitmap Index Scan` сам по собі коштує 8 buffers —
основна вартість тепер у `Heap Blocks: exact=2320` (треба таки дістати самі
2926 рядків-збігів із таблиці; GIN лише каже, де вони). Buffers: 5726 →
2334, Execution Time: 22.9 мс → 6.2 мс (~3.7×) — приріст менший, ніж у
q1-q3, бо тут прибирається лише Seq Scan над "зайвими" 97.6 % рядків, а
2.4 % релевантних усе одно треба прочитати з диска/кешу через heap fetch.

## Морфологія

`search_vector` побудовано на конфігурації `'simple'`
(`to_tsvector('simple', name || ' ' || description)`). На відміну від
`'russian'`/`'ukrainian'`-подібних конфігів, `'simple'` **не стемить** —
кожна словоформа стає окремою лексемою:

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
-- 5880
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');
-- 0
```

**Кросівки** (називний відмінок, множина — саме так слово завжди стоїть у
назві/описі товару) дає 5880 збігів; **кросівок** (родовий відмінок
множини) — 0, хоча семантично це те саме слово. Причина — у
`pg_ts_config`/`\dF`: `'simple'` використовує лише `simple`-словник, який
лише нормалізує регістр і прибирає пунктуацію, без морфологічного аналізу;
`to_tsvector('simple', 'кросівок')` і `to_tsvector('simple', 'кросівки')`
виробляють два різні, ніяк не пов'язані токени. Це не баг і не те, що
можна "полагодити" індексом — щоб пошук працював по відмінках, потрібен
словник з українською морфологією (наприклад, `ispell`/`hunspell`-словник
для `uk`), а не заміна `'simple'` на `'russian'` — це інша мова з іншою
граматикою, а не фікс.

## Додатково: ціна генерованої tsvector-колонки

```sql
-- products із search_vector:      49 MB (51 699 712 bytes)
-- та сама таблиця без search_vector: 23 MB (24 125 440 bytes)
```

Збережена (`STORED`) `tsvector`-колонка на 120 000 товарів роздула таблицю
приблизно вдвічі (49 МБ проти 23 МБ) — очікувана й свідома ціна: натомість
не треба підтримувати `search_vector` вручну ні на `INSERT`, ні на `UPDATE`.
