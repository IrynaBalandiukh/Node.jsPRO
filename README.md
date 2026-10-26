# Marketplace API

> Курсовий проєкт Node.js PRO. Цей README — архітектурна записка (ДЗ#0) і
> живий документ на всі 17 ДЗ курсового. Рішення нижче не переписуються —
> зміни фіксуються в [Журналі рішень](#журнал-рішень).

---

## 1. Що це за сервіс

Marketplace API — платформа, де продавці (`Seller`) виставляють товари на
продаж, а покупці (`Buyer`) переглядають каталог, оформлюють і оплачують
замовлення. Сервіс вирішує дві проблеми: координацію обмеженого залишку (`stock`) під конкурентним попитом
і гарантію, що кожне замовлення обробляється рівно один раз навіть при
мережевих повторах запиту (retry з боку клієнта).

**User stories:**

1. Як `Buyer`, я хочу переглядати каталог товарів із фільтрами й пагінацією,
   щоб швидко знайти потрібний товар.
2. Як `Buyer`, я хочу оформити замовлення й оплатити його так, щоб повторний
   запит з тим самим `Idempotency-Key` не спричинив задвоєне списання.
3. Як `Seller`, я хочу додавати й редагувати свої товари разом із фото, щоб
   представити їх покупцям.
4. Як `Seller`, я хочу отримувати сповіщення про нове замовлення на свій
   товар, щоб оперативно його обробити.

## 2. Домен

| Сутність       | Що зберігає                                                                           | Ключові звʼязки                                                                            |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `User`         | id, email, password_hash, role (`buyer`\|`seller`)                                    | 1──n `Product` (як seller), 1──n `Order` (як buyer), 1──n `Notification`                   |
| `Product`      | id, seller_id, name, description, price_cents, stock, photos[]                        | n──1 `User` (seller), n──n `Order` через `OrderItem`                                       |
| `Order`        | id, buyer_id, status (`pending`\|`paid`\|`cancelled`), items, total_cents, created_at | n──1 `User` (buyer), n──n `Product` через `OrderItem`, 1──1 `Payment`, 1──n `Notification` |
| `Payment`      | id, order_id, amount_cents, status (`pending`\|`succeeded`\|`failed`), provider_ref   | 1──1 `Order`                                                                               |
| `Notification` | id, user_id, order_id, type (`order_created`\|`order_paid`\|...), payload, read_at    | n──1 `User`, n──1 `Order`                                                                  |

```
User (buyer│seller)
  │ 1──n (seller_id)              │ 1──n (buyer_id)
  ▼                                ▼
Product ──n──n (OrderItem)──n──1─ Order ──1──1── Payment
                                    │
                                    └──1──n──▶ Notification ──n──1──▶ User
```

У контракті ДЗ №1 описано лише `Product` і `Order`. `User`, `Payment` і
`Notification` — заплановані сутності: вони зʼявляться в API та схемі разом
з автентифікацією, оплатою і чергою (наступні ДЗ).

### Перевірка домену

| Потрібно                             | Що це у мене                                                          | Де знадобиться                   | ✓   |
| ------------------------------------ | --------------------------------------------------------------------- | -------------------------------- | --- |
| ≥ 2 ролі з різними правами           | `buyer` / `seller` (заплановано, auth ще немає)                       | #24 RBAC                         | ✅  |
| Обмежений ресурс, за який конкурують | `Product.stock` — конкурентний декремент при паралельних замовленнях  | #14 транзакція під навантаженням | ✅  |
| Операція з незворотним ефектом       | Створення `Order` + `Payment`, вже захищене `Idempotency-Key` (ДЗ №1) | #22 outbox + idempotency         | ✅  |
| Подія, про яку треба сповістити      | `order.created` → продавцю, `order.paid` → покупцю                    | #18 realtime · #19 черга         | ✅  |
| Сутність із файлами                  | `Product.photos` — фото товару                                        | #26 S3 presigned                 | ✅  |
| Дані «часто читають, рідко пишуть»   | Каталог `Product`                                                     | #23 cache-aside                  | ✅  |
| 4–6 сутностей зі звʼязками           | `User`, `Product`, `Order`, `Payment`, `Notification` (5)             | #12 схема · #13 entities         | ✅  |

## 3. Архітектурні рішення

| Питання        | Рішення                                                                  | Чому саме так                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute model  | Modular monolith (NestJS-модулі)                                         | Соло-розробка; мікросервіси додали б deployment/observability overhead без виграшу на цьому масштабі. Межі модулів (`products/`, `orders/`, майбутні `users/`, `payments/`) навмисно чіткі, щоб виокремити сервіс пізніше, якщо знадобиться. |
| База даних     | PostgreSQL                                                               | Потрібні транзакції при декременті `Product.stock` під конкурентним навантаженням — eventual consistency тут коштувала б овербукінгом.                                                                                                       |
| Асинхронність  | RabbitMQ                                                                 | Черга сповіщень (`order.created` → продавцю, `order.paid` → покупцю) потребує надійної доставки «раз і назавжди»; replay подій (Kafka) домену поки не потрібен.                                                                              |
| Автентифікація | JWT (access + refresh)                                                   | Stateless — кілька інстансів застосунку за балансувальником без спільного session-store. Ціна — складніший миттєвий revoke (див. Trade-offs).                                                                                                |
| Deploy         | Docker Compose (лок. і поки що прод) → Kubernetes (навчальна ціль курсу) | Compose вже в репо для Postgres і цілком достатній для реального навантаження цього проєкту. Kubernetes додано як навчальну ціль курсу (розгортання кількох інстансів, health-проби, секрети); сам домен на цьому масштабі його не вимагає.  |

**Де мені знадобляться транзакції:** декремент `Product.stock` під час
створення `Order` (щоб уникнути overselling при паралельних покупках) і
атомарна зміна `Order.status → paid` разом зі створенням `Payment`.

**Яка подія піде через чергу першою:** `order.created` → сповіщення
продавцю. `Idempotency-Key` гарантує, що замовлення створюється один раз.
Щоб подія не загубилась між записом у базу і відправкою в RabbitMQ, вона
записується в таблицю outbox у тій самій транзакції, що й замовлення, а окремий процес доставляє її в чергу. Доставка — «принаймні один
раз», тому споживач ігнорує дублікати за `id` події.

**Ролі та їхні права:**

- `buyer` — перегляд каталогу, створення власних замовлень, оплата.
- `seller` — CRUD власних товарів (тільки `seller_id === user.id`),
  перегляд замовлень на свої товари.

## 4. Trade-offs

| Відкинув                     | Чому                                                                                                   | За яких умов повернувся б                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Мікросервіси зараз           | Соло-розробка; overhead деплою й спостережуваності не виправданий на цьому масштабі                    | Якщо читання каталогу і запис замовлень почнуть вимагати незалежного масштабування (різні профілі навантаження) |
| NoSQL (MongoDB) для каталогу | Потрібні транзакції та foreign keys (`Order`↔`Product`↔`Payment`), а не гнучка схема                   | Якщо товари матимуть дуже різнорідні атрибути за категоріями (довільні поля)                                    |
| Sessions замість JWT         | JWT дає stateless горизонтальне масштабування без спільного session-store                              | Якщо знадобиться миттєвий примусовий revoke (бан користувача має діяти негайно) — тоді додам blacklist у Redis  |
| Kafka замість RabbitMQ       | Домену поки не потрібен replay подій чи event sourcing — лише надійна доставка «одна подія → одна дія» | Якщо зʼявиться потреба в audit log/аналітиці на основі повної історії подій замовлення                          |

**Найбільший ризик мого вибору:** один Postgres-інстанс під усім
навантаженням модульного моноліту — конкурентні декременти `stock` під час
пікових замовлень можуть вичерпати connection pool і сповільнити навіть
незв'язані запити каталогу («шумний сусід»).

**Як я помічу, що помилився:** зростання p95 latency `GET /products`
корелює з навантаженням на `POST /orders` (моніторинг per-endpoint latency
\+ Postgres connection pool usage) — сигнал, що читання каталогу варто
виокремити (репліка на читання або окремий сервіс).

---

## Запуск

_(буде описано пізніше)_

## Структура файлів

```
src/            — код застосунку (NestJS, TypeScript)
openapi/        — OpenAPI-спека (openapi.yaml): контракт API
db/             — SQL дата-шару: init.sql (роль застосунку), schema.sql, seed.sql,
                  indexes.sql,
                  queries/ (q1–q4) і OPTIMIZATIONS.md (звіт EXPLAIN)
scripts/        — допоміжні скрипти: check-spec.js (спека),
                  check-env-example.mjs (.env.example проти схеми),
                  rotate.sh (ротація пароля БД без рестарту застосунку)
pacts/          — поки порожня (під контрактні тести)
dist/           — результат збірки (npm run build); у .gitignore
Dockerfile      — образ застосунку
docker-compose.yml — Postgres для локального запуску
.env.example    — контракт змінних середовища (реальний .env — у .gitignore)
package.json    — залежності та npm-скрипти
tsconfig.json   — налаштування TypeScript
README.md       — цей документ
```

---

## Журнал рішень

### 2026-09-20

Було: Express (написаний на ДЗ №1). Стало: NestJS + TypeScript.

Причина: курс — про NestJS, і подальший конфіг-скелет (`ConfigModule`, DI)
розрахований саме на нього. Контракт, cursor-пагінація, `Idempotency-Key` і
`problem+json`-помилки поведінково не змінились.

### 2026-10-22

Було: три ролі — `buyer`, `seller`, `admin` (user story №5: модерація,
блокування товару чи продавця). Стало: дві ролі — `buyer` і `seller`.

Причина: спрощення домену. Модерація потребувала б додаткових полів
(блокування користувача/товару) і окремих прав, які зараз не потрібні
жодній user story. Вимога «≥ 2 ролі з різними правами» лишається виконаною.
Спочатку змінено лише README; `db/schema.sql` і `db/seed.sql` вирівняно
в ДЗ №3 (роль `admin` прибрано, у `users.role` лишились `buyer` і `seller`).

### 2026-10-23 (ДЗ №4, `hw-13`)

Було: пароль БД лежав у файлі `secrets/db_password` (`DB_PASSWORD_FILE`),
який перечитується на кожне нове зʼєднання. Стало: команди, що ходять у базу
(`migrate`, `migrate:show`, `migrate:revert`, `seed`, `demo:nplus1`, `report`),
отримують `DB_*` зі сховища секретів Infisical через обгортку
`scripts/with-secrets.sh dev ...` (`infisical run`).

Причина: умова ДЗ №13 вимагає, щоб підключення TypeORM CLI приходило лише з
`process.env`, який наповнює сховище, без зашитих значень і власних
env-файлів. `src/data-source.ts` тому читає тільки `process.env`
(`DB_URL` або `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`).

Межі: секрет-файл із ротацією без рестарту лишається для самого застосунку
(NestJS, `ConfigModule`) — Infisical замінив його лише для CLI-команд. Якщо
доступу до сховища немає (грейдер, свіжий клон), обгортка працює зі
`SKIP_VAULT=1`: значення `DB_*` беруться напряму з оточення.

---

## Реалізація

### ДЗ №1 — OpenAPI-контракт

**Що зроблено.** Описано контракт Marketplace API в `openapi/openapi.yaml`:
2 ресурси (`products`, `orders`) і 5 операцій (список і картка товару,
список замовлень, створення замовлення, картка замовлення). У контракті є
cursor-пагінація (`limit`, `cursor`, `next_cursor`), обовʼязковий заголовок
`Idempotency-Key` для `POST /orders` (з описом семантики повтору) і помилки
у форматі `application/problem+json`.

У контракті поки лише `Product` і `Order`; решта сутностей домену
(`User`, `Payment`, `Notification`) — заплановані.

**Обраний варіант: Б** — сервер із `express-openapi-validator`. Він
підвантажує спеку і сам відхиляє запити й відповіді, що їй суперечать.

**Команди перевірки** (після `npm install`):

```
npm run lint:openapi     # спека валідна (exit code 0)
npm run check:openapi    # обсяг спеки: операцій ≥ 5, ресурсів ≥ 2,
                         # Idempotency-Key required, опис ≥ 40 символів
npm start                # запуск сервера (потрібен .env — див. Configuration)
```

Contract-частина (в іншому терміналі, після `npm start`):

```
# без Idempotency-Key -> 400 problem+json
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"product_id\":\"prod_1\",\"quantity\":1}]}"

# порожні items -> 400 problem+json
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k1" \
  -d "{\"items\":[]}"

# валідний запит -> 201
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k2" \
  -d "{\"items\":[{\"product_id\":\"prod_1\",\"quantity\":1}]}"
```

### ДЗ 2 - Configuration

Усі змінні середовища описані однією zod-схемою
(`src/config/env.schema.ts`) і перевіряються на старті через
`ConfigModule.forRoot({ validate })`. Якщо змінної немає або вона невалідна,
процес одразу завершується з кодом 1 і виводить **усі** зламані змінні разом
із причиною. У коді немає прямих читань `process.env`: конфіг береться тільки
через типізований `ConfigService<Env, true>`.

#### Змінні середовища

| Змінна             | Обовʼязкова | Default       | Призначення                                                                    | Джерело                                                                                                                                             |
| ------------------ | ----------- | ------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | ні          | `development` | `development` \| `production` \| `test`                                        | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `PORT`             | ні          | `3000`        | HTTP-порт застосунку                                                           | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DB_HOST`          | так         | —             | Хост Postgres                                                                  | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DB_PORT`          | ні          | `5432`        | Порт Postgres                                                                  | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DB_NAME`          | так         | —             | Назва бази                                                                     | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DB_USER`          | так         | —             | Роль Postgres, під якою підключається застосунок                               | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DB_PASSWORD_FILE` | так         | —             | Шлях до файлу з паролем (не сам пароль!)                                       | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod)                                                                                       |
| `DATABASE_URL`     | так         | —             | Один рядок підключення для `psql` і інструментів. Сам застосунок його не читає | **сховище ДЗ №2/#11:** `.env` (dev; контракт і фейковий пароль — у `.env.example`) / секрети оркестрації (prod). Окремого env-файлу під нього немає |

Контракт змінних — файл `.env.example` (у git, з фейковими значеннями).
Реальний `.env` і тека `secrets/` — в `.gitignore` та `.dockerignore`, тобто
не потрапляють ні в git, ні в Docker-образ. Перевірити, що `.env.example` не
відстав від схеми: `npm run check:env` (exit 1, якщо відстав).

#### Локальний запуск

```
npm install
copy .env.example .env          # у bash: cp .env.example .env
mkdir secrets
echo changeme_local_dev_password> secrets/db_password
docker compose up -d --wait postgres   # Postgres; db/init.sql створює роль marketplace_app
npm start
```

Пароль у `secrets/db_password` має збігатися зі стартовим паролем з
`db/init.sql` і з паролем у `DATABASE_URL`. Перевірка:
`curl http://localhost:3000/health`. Документація API (Swagger UI) —
`http://localhost:3000/docs`.

#### Ротація пароля БД (без рестарту застосунку)

Застосунок читає пароль із файлу `DB_PASSWORD_FILE` на кожне нове зʼєднання з
базою, а не один раз на старті, тому пароль можна змінити, не перезапускаючи
сервіс. З кореня проєкту (Postgres має працювати в compose):

1. `curl http://localhost:3000/health` — запамʼятай `uptime`.
2. `bash scripts/rotate.sh` (або `bash scripts/rotate.sh <новий_пароль>`).
   Скрипт по черзі: змінює пароль ролі в Postgres (`ALTER ROLE`), записує його
   в `secrets/db_password`, закриває старі зʼєднання (`pg_terminate_backend`)
   і оновлює пароль у `DATABASE_URL` у `.env`.
3. `curl http://localhost:3000/health` — відповідь `200`, а `uptime` більший за
   попередній: процес не перезапускався.

Після `docker compose down -v` Postgres повертається до стартового пароля з
`db/init.sql`, тож поверни `secrets/db_password` до цього значення, інакше
буде `password authentication failed`.

### ДЗ 3 - База даних

Підняти базу (один рядок; на свіжому клоні без правок файлів, дев-креденшели
лежать у `docker-compose.yml` і `db/init.sql`):

```
docker compose up -d --wait postgres
```

Підключитись (один рядок):

```
docker compose exec postgres psql -U marketplace_app -d marketplace
```

Створити схему, наповнити даними й додати індекси (у цьому порядку):

```
npm run db:schema
npm run db:seed
npm run db:indexes
docker compose exec postgres psql -U marketplace_app -d marketplace -c "ANALYZE;"
```

`ANALYZE` після індексів оновлює статистику, щоб планувальник одразу
використовував нові індекси.

Запити для замірів лежать у `db/queries/` (q1–q4). Запустити один із них
(Git Bash):

```
(echo "EXPLAIN (ANALYZE, BUFFERS)"; cat db/queries/q1.sql; echo ";") | docker compose exec -T postgres psql -U marketplace_app -d marketplace
```

Результати «до» і «після» індексів, пояснення та розділ про морфологію —
у [`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

Головна таблиця — `orders` (110 000 рядків), таблиця, по якій шукає q4, —
`products` (120 000 рядків).

---

### ДЗ 4 - TypeORM-шар

Та сама схема з ДЗ №3, тільки тепер через TypeORM: entities, relations і
міграції. `synchronize` не вмикається ніде (у `src/data-source.ts` стоїть
`synchronize: false`, схемою керують лише міграції).

```
src/entities/     # user, product, order, order-item (явна join-entity)
src/migrations/   # InitSchema: згенерована, expression-індекс додано руками
src/data-source.ts, src/seed.ts, src/demo-nplus1.ts, src/report.ts
```

`search_vector` (generated `tsvector`) і його GIN-індекс у TypeORM-шарі не
відтворюються: їх описує `db/schema.sql` + `db/indexes.sql`. Partial-індекс
описано в entity через `@Index(..., { where })`, а expression-індекс
(`lower(email)`) `@Index` виразити не вміє, тому він створений вручну в
міграції.

#### Relations і onDelete

| Зв'язок                       | `onDelete` | Чому                                                    |
| ----------------------------- | ---------- | ------------------------------------------------------- |
| `Product.seller → User`       | `RESTRICT` | не можна видалити продавця, поки в нього є товари       |
| `Order.buyer → User`          | `RESTRICT` | не можна видалити покупця, поки в нього є замовлення    |
| `OrderItem.order → Order`     | `CASCADE`  | позиції не існують без замовлення                       |
| `OrderItem.product → Product` | `RESTRICT` | не можна видалити товар, що є в існуючому замовленні    |

`order_items` — зв'язок M:N з даними (`quantity`, `unit_price_cents`), тому
це явна entity, а не `@ManyToMany`.

#### Міграції

```
npm run build
npm run migrate           # створює схему
npm run migrate:show      # [X] InitSchema
npm run migrate:revert    # відкат: down() видаляє всі таблиці
npm run migrate           # схема повертається
```

Нова міграція після зміни entities (попередню спершу застосувати):
`npm run build && npm run migration:generate -- src/migrations/Name`.

#### Seed

```
npm run seed
npm run seed    # повторний запуск: без помилок, без дублів
```

Перевірка, що кількість рядків не змінилась:

```
docker compose exec postgres psql -U marketplace_app -d marketplace -c "SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM products) products, (SELECT count(*) FROM orders) orders, (SELECT count(*) FROM order_items) order_items;"
```

Очікується: `users = 7`, `products = 10`, `orders = 8`, `order_items = 13` і
до, і після другого запуску. Користувачі дедуплікуються через
`INSERT ... ON CONFLICT DO NOTHING` (унікальний індекс на `lower(email)`), товари й замовлення — за детермінованим маркером
(назва / `created_at`), позиції створюються разом із замовленням.

#### N+1

```
npm run demo:nplus1
```

Граф `order → items → product` (2 рівні). Наївно: запит на кожне
замовлення й на кожну позицію в циклі. Два фікси: `relations: { items: {
product: true } }` (один JOIN) і те саме з `relationLoadStrategy: 'query'`
(окремий запит на кожну таблицю).

| Стратегія                                   | N=4         | N=8         |
| ------------------------------------------- | ----------- | ----------- |
| наївно (запит у циклі)                      | 17 запитів  | 35 запитів  |
| `relations` (один JOIN)                     | **1 запит** | **1 запит** |
| `relationLoadStrategy: 'query'`             | 5 запитів   | 5 запитів   |

«До» ≥ N і росте з N (17 → 35). «Після» не залежить від N: 1 запит для JOIN і
5 для `query`-стратегії, що вкладається в межу 1 + 2 × 2 = 5.

#### Звіт: QueryBuilder vs Repository

```
npm run report
```

Топ продавців за виторгом (`status = 'paid'`): `SUM`, `COUNT`, `GROUP BY` і
3 JOIN через `createQueryBuilder().getRawMany()` (`src/report.ts`). `find()`
не вміє агрегати й `GROUP BY`. Результат на seed-наборі: seller3 — 49694.00
(4 замовлення), seller1 — 2246.00 (2), seller2 — 1899.00 (1).

**Межа:** якщо потрібен граф entities без обчислень, беру `Repository.find()`.
Якщо в запиті є агрегат (`SUM`/`COUNT`) або `GROUP BY` (звіт, дашборд), беру
`QueryBuilder`.

#### Підключення до бази

`src/data-source.ts` читає підключення лише з `process.env`, без зашитих
значень. Усі скрипти, що ходять у базу (`migrate`, `migrate:show`,
`migrate:revert`, `seed`, `demo:nplus1`, `report`), починаються з
`bash scripts/with-secrets.sh dev ...`. Обгортка бере змінні з
`SKIP_VAULT=1` (вони вже в оточенні), з локального `.secrets/infisical.env`
або з `infisical run`.

### ДЗ 5 - Конкурентність

Що додано: міграція `1790200000000-ConcurrencyLayer` (колонка `users.balance_cents`
з `CHECK >= 0` і таблиця черги `jobs`), `src/checkout.ts` (транзакційне
оформлення замовлення), `src/worker.ts` (воркер на `FOR UPDATE SKIP LOCKED`),
`src/retry.ts` (обгортка retry) і три демо. Усі три `npm run demo:*` ходять у
базу через `scripts/with-secrets.sh` і самі перевіряють інваріанти (exit code ≠ 0
при порушенні). Перед кожним запуском npm `pre*`-хук збирає `dist/` (`tsc`).

```
npm run demo:race      # 50 паралельних checkout на товар зі stock = 10
npm run demo:workers   # пул із 4 воркерів, 40 задач по 100 мс
npm run demo:retry     # 8 конкурентних read-modify-write під REPEATABLE READ
```

#### Числа з моїх запусків

| Демо | Результат |
|------|-----------|
| `demo:race` | спроб **50**, успішних **10**, відмов «немає товару» 40, фінальний stock **0**, рядків із відʼємним stock **0**, замовлень 10 = успішних, задач `post_process` 10, списано 123 450 коп. = 10 × ціна; ~550 мс |
| `demo:workers` | 40 задач × 100 мс, 4 воркери: по 10 на воркер, **оброблено двічі: 0**, **1254 мс** проти 4000 мс послідовно |
| `demo:retry` | 8 транзакцій `+100`: **24 retry**, усі `40001`; фінальний баланс **800** = 8 × 100 (кількість retry плаває від запуску до запуску) |

#### Checkout: atomic UPDATE, а не pessimistic lock

Обрано атомарний `UPDATE products SET stock = stock - $n WHERE id = $1 AND stock >= $n
RETURNING price_cents` (так само для балансу): перевірка і декремент — один
оператор, який бере рядковий лок сам, тож між «перевірити» й «списати» немає
вікна для гонки. Механізм: конкурентний `UPDATE` того ж рядка чекає зняття
рядкового локу, а після `COMMIT` першої транзакції (рівень ізоляції READ COMMITTED,
типовий у PostgreSQL) заново перевіряє `WHERE` на новій версії рядка — тому
після останньої одиниці `stock >= $n` хибне. 0 повернених рядків = товару/коштів нема, і це відразу
бізнес-відмова без окремого `SELECT`. `SELECT … FOR UPDATE` потребує двох
раундтрипів і read-modify-write у JS, дає довший час утримання локу і не
додає нічого, коли правило — проста нерівність на одній колонці; його варто
брати, коли рішення залежить від кількох прочитаних рядків/складної логіки.
Позиції замовлення обробляються у відсортованому за `product_id` порядку —
однаковий порядок локів усуває deadlock між багатотоварними замовленнями.
Транзакція живе на одному `QueryRunner` (одне з'єднання), `CHECK`-констрейнти
`stock >= 0` і `balance_cents >= 0` — друга лінія захисту в самій БД.

Атомарність: декремент `stock`, списання балансу, `INSERT` у `orders` /
`order_items` і `INSERT` задачі `post_process` у `jobs` — одна транзакція. Будь-яка
помилка (`OutOfStockError`, `InsufficientFundsError`, збій БД) дає `ROLLBACK` усього
разом, тож замовлень-«сиріт» (без списання або без зменшеного складу) і задач без
замовлення не існує; задачу потім виконує воркер окремо.

#### Воркер-пул

Кожен воркер у циклі відкриває транзакцію, бере одну задачу
`SELECT … WHERE status='pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
виконує її, і в тій самій транзакції ставить `status='done', processed = processed + 1`.
Залочені іншими воркерами рядки пропускаються, а не блокують. Впав воркер до
`COMMIT` — лок зник, задачу підбере інший. Порожній результат `SKIP LOCKED` —
це «вільних зараз нема», тому перед виходом воркер перепитує `count(*)` pending-рядків.

#### Чому retry ловить лише `40001` і `40P01`

`40001` (serialization_failure) і `40P01` (deadlock_detected) — єдині помилки, про
які PostgreSQL прямо каже «транзакцію відкочено через конкуренцію, спробуй
ще раз»: повтор з новим читанням дає інший результат. Усе інше
(`23xxx` порушення constraint, `42xxx` помилки SQL, `OutOfStock` /
`InsufficientFunds`, обрив зʼєднання) детерміновано повториться так само
або, гірше, дублює побічні ефекти; ретрай таких помилок ховає баги.
Обгортка `withRetry` повторює транзакцію **цілком**, включно з читаннями
(повтор самого запису на застарілому читанні — той самий lost update),
з експоненційним backoff + jitter і лімітом спроб, кожен повтор логується.

## Data layer ops (ДЗ №15)

Застосунок ходить у базу **через PgBouncer**: `app → pgbouncer:6432 → postgres:5432`.
Конфіг — `pgbouncer/pgbouncer.ini` (+ `userlist.txt` з дев-паролем), `pool_mode = transaction`,
`default_pool_size = 10`, `max_client_conn = 200`, адмін-консоль для `marketplace_app`.
Рядок підключення (`DATABASE_URL`) у сховищі ДЗ #11 (dev і prod) треба вказати на хост/порт
пулера — окремого env-файла немає; у `.env.example` оновлено хост/порт (пароль фейковий).

```
docker compose up -d --wait                       # postgres + pgbouncer
psql -h 127.0.0.1 -p 6432 -U marketplace_app -d marketplace -c "SELECT 1"
psql -h 127.0.0.1 -p 6432 -U marketplace_app -d pgbouncer -c "SHOW POOLS"   # pool_mode = transaction
```

**Бекап.** `bash scripts/with-secrets.sh dev bash scripts/backup.sh` → `pg_dump -Fc` у
`backups/<db>_<YYYY-MM-DD_HH-MM-SS>.dump` (тека поза контейнером, у `.gitignore`) + поруч
`.checksum` з контрольними значеннями на момент бекапу. Скрипт друкує шлях і сам перевіряє
архів через `pg_restore --list`. Дамп береться з контейнера `postgres` **повз пулер** (довга
REPEATABLE READ транзакція з `SET`-ами погано сумісна з transaction mode), тому на хості не
потрібні `pg_dump`/`psql`. Розклад — `backup.cron` (щоночі о 02:30).

**Відновлення / drill.** `bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh`:
бере останній дамп, піднімає окремий контейнер `postgres:16-alpine` з новим порожнім volume,
робить `pg_restore --no-owner`, порівнює `users|products|orders|order_items|sum(orders)` із
`.checksum` і друкує `MATCH` (інакше exit 1). Контейнер і volume створюються та знищуються
самим скриптом, повторний запуск завжди з нуля. Результат прогону, RTO і RPO — `RESTORE-DRILL.md`.
Ручне відновлення в робочу БД: `pg_restore --no-owner --clean --if-exists -d <db> <файл>`.

### Чому transaction mode і що він ламає

Transaction mode віддає серверне з'єднання клієнту лише на час транзакції, тож 200 клієнтів
обслуговуються 10 з'єднаннями Postgres — для API з короткими запитами це найкраща віддача
пулу. Ціна: сесійний стан не гарантовано живе між транзакціями, бо наступна транзакція
клієнта може піти в інше серверне з'єднання. Ламаються: (1) session-level `SET`
(`search_path`, `statement_timeout`, `timezone`) — треба `SET LOCAL` усередині транзакції;
(2) named prepared statements драйвера — вимкнути або `max_prepared_statements = 200`
(PgBouncer ≥ 1.21, у конфігу ввімкнено); (3) session-level advisory locks
(`pg_advisory_lock`) — лок лишається на чужому з'єднанні, є лише `pg_advisory_xact_lock`;
(4) `LISTEN/NOTIFY` і `WITH HOLD`-курсори; (5) `DISCARD ALL`/temp tables між транзакціями.
Міграції й `FOR UPDATE`/`SKIP LOCKED` із ДЗ #14 працюють, бо живуть усередині однієї транзакції.

## Grading

Грейдер не має доступу до сховища, тому запускає все з `SKIP_VAULT=1`; значення
`DB_*` — дев-креденшели з `docker-compose.yml` (не секрет):

```
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=marketplace_app DB_PASSWORD=changeme_local_dev_password DB_NAME=marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища

npm ci
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed
npm run seed
npm run demo:nplus1
npm run report

# ДЗ №14 (конкурентність) — та сама база, ті самі змінні, ті самі SKIP_VAULT/DB_*.
# Замість DB_* можна задати єдиний рядок: export DATABASE_URL=postgres://marketplace_app:changeme_local_dev_password@127.0.0.1:5432/marketplace
npm run demo:race           # спроб 50, успішних 10, stock 0, відʼємних 0; exit 0
npm run demo:workers        # "оброблено двічі: 0", розподіл по 4 воркерах, час < послідовного
npm run demo:retry          # пійманий 40001 + повтор, баланс сходиться; exit 0

# ДЗ №15 (PgBouncer + backup + restore-drill). Підключення — через PgBouncer (:6432).
# Скрипти беруть підключення лише з $DATABASE_URL (без обгортки всередині), тому достатньо export.
# Докер потрібен лише для `docker compose` — pg_dump/psql на хості не потрібні.
export DATABASE_URL=postgres://marketplace_app:changeme_local_dev_password@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
npm run migrate && npm run seed                 # щоб було що бекапити (на порожній БД теж працює)
bash scripts/with-secrets.sh dev bash scripts/backup.sh          # друкує backups/marketplace_<дата>.dump
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh   # друкує MATCH, exit 0
```

Точкові перевірки:

```
grep -rn "synchronize" src/    # synchronize: false
grep -rn "onDelete" src/       # CASCADE і RESTRICT
```
