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

### 2026-09-22 (ДЗ №4, `hw-13`)

Було: raw-SQL схема з ДЗ №3 (`db/`). Стало: та сама схема — entities +
relations + міграції TypeORM (`src/entities/`, `src/migrations/`). Гроші вже
були `integer` у мінорних одиницях (`*_cents`) у `db/schema.sql`, тож тут
нічого не змінилось. Деталі й обґрунтування — розділ
[TypeORM-шар (ДЗ №4)](#typeorm-шар-дз-4).

Секрети (`scripts/with-secrets.sh`): умова ДЗ №13 припускає, що ця
обгортка вже існує з ДЗ №11 — але фактичний ДЗ №11 у цьому репо пішов
іншим шляхом (`DB_PASSWORD_FILE` — секрет-файл, що перечитується на кожне
нове з'єднання для ротації без рестарту, розділ
[Ротація пароля БД](#ротація-пароля-бд-без-рестарту-застосунку)), Infisical
у репо не заводився. Обгортку написано з нуля саме зараз, за точною
специфікацією з умови ДЗ №13, — основний шлях веде у сховище
(`infisical run`), `SKIP_VAULT=1` лишається аварійним входом для грейдера
(п.8 умови), а не основним способом роботи.

### 2026-10-22

Було: три ролі — `buyer`, `seller`, `admin` (user story №5: модерація,
блокування товару чи продавця). Стало: дві ролі — `buyer` і `seller`.

Причина: спрощення домену. Модерація потребувала б додаткових полів
(блокування користувача/товару) і окремих прав, які зараз не потрібні
жодній user story. Вимога «≥ 2 ролі з різними правами» лишається виконаною.
Спочатку змінено лише README; `db/schema.sql` і `db/seed.sql` вирівняно
в ДЗ №3 (роль `admin` прибрано, у `users.role` лишились `buyer` і `seller`).

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

## TypeORM-шар (ДЗ №4)

Та сама схема з ДЗ №3 — тепер підняна над TypeORM так, як це робиться у
проді: entities + relations + міграції, без жодного `synchronize: true`.

```
src/entities/
  user.entity.ts        # users
  product.entity.ts      # products
  order.entity.ts         # orders
  order-item.entity.ts     # order_items — явна join-entity (не @ManyToMany)
  index.ts                 # barrel-експорт
src/migrations/
  <ts>-InitSchema.ts        # згенерована migration:generate, руками додано
                             # 2 індекси (partial + expression), яких
                             # декоратор @Index не вміє виразити
src/data-source.ts         # synchronize: false, підключення лише з process.env
src/seed.ts                 # детермінований ідемпотентний seed
src/demo-nplus1.ts           # N+1 "до/після" з лічильником SQL-запитів
src/report.ts                 # звіт через createQueryBuilder().getRawMany()
scripts/with-secrets.sh        # обгортка над vault (Infisical) для команд, що ходять у базу
```

### Відмінності від db/schema.sql (ДЗ №3)

Гроші — `integer` у мінорних одиницях (`price_cents`, `unit_price_cents`),
так само як у `db/schema.sql`. Суму замовлення entity зберігає як
`total_amount_cents` (`integer`), а `db/schema.sql` — як `total_cents`
(`bigint`). `PRIMARY KEY` — `bigint`
(значення повертаються як `string` у TS, щоб не впертися в межу `Number` на
великих ID/агрегатах).

`search_vector` (generated `tsvector` + GIN, ДЗ №3) у TypeORM-шар свідомо не
перенесений: повнотекстовий пошук не входить у задачі relations/N+1/report
цього ДЗ, а `GENERATED ALWAYS AS ... STORED` TypeORM не вміє виразити
декларативно через `@Column` без додаткового ручного SQL, яке нічого не
додало б до acceptance criteria. Raw-SQL дизайн у `db/` лишається
задокументованим джерелом істини для FTS.

### Relations і onDelete

| Зв'язок | Тип | `onDelete` | Чому |
|---|---|---|---|
| `Product.seller → User` | `n──1` | `RESTRICT` | Товари продавця — його історія; видалити продавця, поки в нього є товари, не можна. |
| `Order.buyer → User` | `n──1` | `RESTRICT` | Замовлення покупця — фінансова історія; видалити покупця, поки в нього є замовлення, не можна. |
| `OrderItem.order → Order` | `n──1` | `CASCADE` | Позиції замовлення — діти замовлення; видалення замовлення видаляє його позиції. |
| `OrderItem.product → Product` | `n──1` | `RESTRICT` | Позиція замовлення фіксує, що саме було куплено; товар з існуючими order_items видалити не можна — інакше історія купівлі втрачає зв'язок з товаром. |

`order_items` — M:N між `Order` і `Product` із даними на зв'язку
(`quantity`, `unit_price_cents` — ціна саме на момент замовлення, може
відрізнятись від поточної `Product.priceCents`), тому явна join-entity
(`OrderItem`), не `@ManyToMany`.

### Міграції

```
docker compose up -d --wait
npm run build
npm run migrate           # створює схему з нуля
npm run migrate:show      # [X] InitSchema...
npm run migrate:revert    # відкочує все — down() не заглушка
npm run migrate           # повертає схему
```

CLI міграцій працює зі скомпільованим `DataSource` (`dist/data-source.js`) —
підказка з умови ДЗ №13: `esbuild`-транспілятори не емітять decorator-метадані,
тому і `migration:generate`, і `migration:run/show/revert` навмисно йдуть
через `npm run build`, а не через `ts-node`.

Щоб згенерувати нову міграцію після зміни entities (тільки коли попередня
вже застосована — інакше генератор побачить порожню діфф-базу і скаже
"No changes..."):

```
npm run build
npm run migration:generate -- src/migrations/ІмʼяЗміни
npm run build
```

### Seed

```
npm run seed
npm run seed    # повторний запуск — без помилок, рядки не дублюються
```

Перевірка ідемпотентності (кількість рядків не змінюється між запусками):

```
docker compose exec postgres psql -U marketplace_app -d marketplace -c \
  "SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM products) products, (SELECT count(*) FROM orders) orders, (SELECT count(*) FROM order_items) order_items;"
```

Фактичний результат: `users = 8`, `products = 10`, `orders = 8`,
`order_items = 13` — і до, і після другого запуску `npm run seed`.

Ідемпотентність: `users` дедуплікуються через `upsert(..., ['email'])`
(email — `UNIQUE` у схемі). `products`/`orders` природного unique-ключа в
схемі не мають, тому дедуплікуються на рівні застосунку — insert
пропускається, якщо рядок з тим самим детермінованим маркером (назва
товару / `created_at` замовлення, обидва фіксовані в `seed.ts`, без
`random()`/`Date.now()`) уже є. `order_items` ідуть услід за своїм `order`:
якщо order уже існував, його items наново не створюються.

### N+1 — доведено і вилікувано

```
npm run demo:nplus1
```

Граф `order → items → product` (2 рівні зв'язків). Наївна стратегія —
список замовлень одним запитом, тоді окремий запит на `items` кожного
замовлення в циклі, і ще окремий запит на `product` кожної позиції в
циклі. N+1 не видно в коді (звичайний `for`-loop) — тільки в лозі SQL
(власний `QueryCountLogger`, що інкрементить лічильник на кожен `query`).

Фактичний результат на seed-наборі (два розміри вибірки — підмножина
покупців vs усі покупці):

| Стратегія | N=4 | N=8 |
|---|---|---|
| наївно (запит у циклі) | 17 запитів | 35 запитів |
| relations (`{ items: { product: true } }`, JOIN) | **1 запит** | **1 запит** |

«До» ≥ N і росте з N (17 → 35). «Після» — стала константа, що не залежить
від N (1 запит і на 4, і на 8 замовлень) — задовольняє критерій «≤ 1 + 2 ×
рівнів» (для 2 рівнів ліміт — 5) із запасом.

### Звіт: QueryBuilder vs Repository

```
npm run report
```

«Топ продавців за виторгом» (тільки `status = 'paid'`): `SUM(quantity *
unit_price_cents)` + `COUNT(DISTINCT order.id)`, `GROUP BY seller`, 3 JOIN
(`order_items → orders`, `order_items → products`, `products → users`).
Реалізовано через `createQueryBuilder().getRawMany()` (`src/report.ts`) —
`find()`/`findOne()` не мають способу виразити агрегатну функцію чи
`GROUP BY`, вони будують entity-графи, а не обчислені рядки.

**Межа Repository vs QueryBuilder у цьому проєкті:** якщо запит — це
"дістати граф entities" (з relations, без обчислень над рядками) —
`Repository.find()`/`findOne()`. Якщо в запиті є агрегатна функція
(`SUM`/`COUNT`/`AVG`), `GROUP BY`, чи потрібен `getRawMany()` над кількома
таблицями одразу (звіт, дашборд, не "картка ресурсу") — `QueryBuilder`.
Проміжний випадок (складний `WHERE`, кілька `JOIN`, але без агрегатів) теж
іде через `Repository.find({ relations, where })` — доки не з'являється
GROUP BY, `find()` лишається читабельнішим і безпечнішим (параметризація з
коробки).

### Секрети / vault

`src/data-source.ts` читає підключення лише з `process.env` — ні зашитого
хоста/пароля, ні читання власного env-файлу
(`grep -nE "password:[[:space:]]*['\"]" src/data-source.ts` — порожньо).
Значення туди приносить `scripts/with-secrets.sh` (ДЗ №11): усі
npm-скрипти, що ходять у базу (`migrate`, `migrate:show`, `migrate:revert`,
`seed`, `demo:nplus1`, `report`), уже загорнуті в
`bash scripts/with-secrets.sh dev ...` — викликаються без жодних
префіксів.

Основний шлях — `infisical run --env=dev -- ...` (кешується локально в
`.secrets/infisical.env`, поза git — одноразово наповнюється через
`infisical export --env=dev > .secrets/infisical.env` після
`infisical login && infisical init`). Аварійний вхід для грейдера —
`SKIP_VAULT=1`: обгортка виконує команду напряму, значення DB_* приходять
з оточення (дев-креденшели `docker-compose.yml`, не секрет). Перевірка, що
обгортка вшита в потрібні скрипти — статична, без доступу до бази чи
сховища:

```
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed']
  .filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);
  console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));
  process.exit(bad.length===0?0:1)"
```

## Grading

Грейдер не має доступу до сховища — підняти й перевірити все можна цими
командами, без правок файлів, зі свіжого клона:

```
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=marketplace_app DB_PASSWORD=changeme_local_dev_password DB_NAME=marketplace
export SKIP_VAULT=1    # у грейдера немає доступу до сховища

npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show      # усі міграції — [X]
npm run migrate:revert    # відкат
npm run migrate           # повертає схему
npm run seed
npm run seed               # ідемпотентно — без помилок, без дублів
npm run demo:nplus1        # "до" >= N, "після" — стала константа
npm run report              # агрегований звіт, GROUP BY
```

### Перевірки — ДЗ №4 (acceptance criteria)

Повний цикл — див. [Grading](#grading) вище. Точкові перевірки:

```
# компіляція чиста
npx tsc --noEmit

# synchronize вимкнено
grep -rn "synchronize" src/    # -> synchronize: false (не true)

# relations: onDelete — щонайменше 2 різні стратегії
grep -rn "onDelete" src/       # -> CASCADE і RESTRICT

# звіт через QueryBuilder: групування є
grep -rniE "\.(add)?groupBy\(" src/

# у DataSource немає зашитого пароля
grep -nE "password:[[:space:]]*['\"]" src/data-source.ts   # -> порожньо

# обгортка вшита в migrate/seed
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed']
  .filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);
  console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));
  process.exit(bad.length===0?0:1)"
```

Фактичний результат на цій машині: `synchronize` — 1 збіг (`false`,
не `true`); `onDelete` — 4 збіги, 2 різні стратегії (`CASCADE`,
`RESTRICT`); `groupBy` — 2 збіги (`.groupBy(`, `.addGroupBy(`); `password:`
з лапками в `data-source.ts` — 0 збігів; обгортка-чек — `OK`. N+1 і
ідемпотентність seed — числа й команда перевірки вище, у розділах
[N+1 — доведено і вилікувано](#n1--доведено-і-вилікувано) та
[Seed](#seed).
