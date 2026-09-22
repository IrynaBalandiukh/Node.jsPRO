# Marketplace API

> Курсовий проєкт Node.js PRO. Цей README — архітектурна записка (ДЗ#0) і
> живий документ на всі 17 ДЗ курсового. Рішення нижче не переписуються —
> зміни фіксуються в [Журналі рішень](#журнал-рішень).

---

## 1. Що це за сервіс

Marketplace API — платформа, де продавці (`Seller`) виставляють товари на
продаж, а покупці (`Buyer`) переглядають каталог, оформлюють і оплачують
замовлення. `Admin` модерує товари й користувачів. Сервіс вирішує дві
проблеми: координацію обмеженого залишку (`stock`) під конкурентним попитом
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
5. Як `Admin`, я хочу бачити всі замовлення і мати змогу заблокувати товар
   або продавця, щоб модерувати платформу.

## 2. Домен

Сутності стануть ресурсами в OpenAPI (ДЗ#9) і таблицями в схемі (ДЗ#12).

| Сутність | Що зберігає | Ключові звʼязки |
|---|---|---|
| `User` | id, email, password_hash, role (`buyer`\|`seller`\|`admin`) | 1──n `Product` (як seller), 1──n `Order` (як buyer), 1──n `Notification` |
| `Product` | id, seller_id, name, description, price_cents, stock, photos[] | n──1 `User` (seller), n──n `Order` через `OrderItem` |
| `Order` | id, buyer_id, status (`pending`\|`paid`\|`cancelled`), items, total_cents, created_at | n──1 `User` (buyer), n──n `Product`, 1──1 `Payment` |
| `Payment` | id, order_id, amount_cents, status (`pending`\|`succeeded`\|`failed`), provider_ref | 1──1 `Order` |
| `Notification` | id, user_id, type (`order_created`\|`order_paid`\|...), payload, read_at | n──1 `User` |

```
User (buyer│seller│admin)
  │ 1──n (seller_id)              │ 1──n (buyer_id)
  ▼                                ▼
Product ──n──n (OrderItem)──n──1─ Order ──1──1── Payment
                                    │
                                    └──1──n──▶ Notification ──n──1──▶ User
```

> Реалізовано станом на ДЗ №2 (`hw-11`): `Product`, `Order` — in-memory,
> без бази (`src/products`, `src/orders`). `User`, `Payment`, `Notification`
> — заплановані сутності, з'являться разом із auth (JWT) і чергою (RabbitMQ)
> на наступних ДЗ.

### Перевірка домену

| Потрібно | Що це у мене | Де знадобиться | ✓ |
|---|---|---|---|
| ≥ 2 ролі з різними правами | `buyer` / `seller` / `admin` (заплановано, auth ще немає) | #24 RBAC | ✅ |
| Обмежений ресурс, за який конкурують | `Product.stock` — конкурентний декремент при паралельних замовленнях | #14 транзакція під навантаженням | ✅ |
| Операція з незворотним ефектом | Створення `Order` + `Payment`, вже захищене `Idempotency-Key` (ДЗ №1) | #22 outbox + idempotency | ✅ |
| Подія, про яку треба сповістити | `order.created` → продавцю, `order.paid` → покупцю | #18 realtime · #19 черга | ✅ |
| Сутність із файлами | `Product.photos` — фото товару | #26 S3 presigned | ✅ |
| Дані «часто читають, рідко пишуть» | Каталог `Product` | #23 cache-aside | ✅ |
| 4–6 сутностей зі звʼязками | `User`, `Product`, `Order`, `Payment`, `Notification` (5) | #12 схема · #13 entities | ✅ |

7/7 — домен витягне курс.

## 3. Архітектурні рішення

| Питання | Рішення | Чому саме так |
|---|---|---|
| Compute model | Modular monolith (NestJS-модулі) | Соло-розробка на 17 ДЗ; мікросервіси додали б deployment/observability overhead без виграшу на цьому масштабі. Межі модулів (`products/`, `orders/`, майбутні `users/`, `payments/`) навмисно чіткі, щоб виокремити сервіс пізніше, якщо знадобиться. |
| База даних | PostgreSQL | Потрібні транзакції при декременті `Product.stock` під конкурентним навантаженням (ДЗ#14) — eventual consistency тут коштувала б овербукінгом. |
| Асинхронність | RabbitMQ | Черга сповіщень (`order.created` → продавцю, `order.paid` → покупцю) потребує надійної доставки «раз і назавжди»; replay подій (Kafka) домену поки не потрібен. |
| Автентифікація | JWT (access + refresh) | Stateless — кілька інстансів застосунку за балансувальником без спільного session-store. Ціна — складніший миттєвий revoke (див. Trade-offs). |
| Deploy | Docker Compose (лок.) → Kubernetes (прод) | Compose вже в репо для Postgres; курс вчить K8s, і домен (кілька незалежних модулів, потенційно різне навантаження на каталог і замовлення) виправдовує оркестратор. |

**Де мені знадобляться транзакції:** декремент `Product.stock` під час
створення `Order` (щоб уникнути overselling при паралельних покупках) і
атомарна зміна `Order.status → paid` разом зі створенням `Payment`.

**Яка подія піде через чергу першою:** `order.created` → сповіщення
продавцю. Оскільки `Idempotency-Key` вже гарантує, що замовлення
створюється рівно один раз, подія публікується так само рівно один раз на
унікальне замовлення.

**Ролі та їхні права:**

- `buyer` — перегляд каталогу, створення власних замовлень, оплата.
- `seller` — CRUD власних товарів (тільки `seller_id === user.id`),
  перегляд замовлень на свої товари.
- `admin` — перегляд і модерація всіх товарів і замовлень, блокування
  користувача чи товару.

## 4. Trade-offs — що я свідомо НЕ роблю

| Відкинув | Чому | За яких умов повернувся б |
|---|---|---|
| Мікросервіси зараз | Соло-розробка; overhead деплою й спостережуваності не виправданий на цьому масштабі | Якщо читання каталогу і запис замовлень почнуть вимагати незалежного масштабування (різні профілі навантаження) |
| NoSQL (MongoDB) для каталогу | Потрібні транзакції та foreign keys (`Order`↔`Product`↔`Payment`), а не гнучка схема | Якщо товари матимуть дуже різнорідні атрибути за категоріями (довільні поля) |
| Sessions замість JWT | JWT дає stateless горизонтальне масштабування без спільного session-store | Якщо знадобиться миттєвий примусовий revoke (бан користувача має діяти негайно) — тоді додам blacklist у Redis |
| Kafka замість RabbitMQ | Домену поки не потрібен replay подій чи event sourcing — лише надійна доставка «одна подія → одна дія» | Якщо зʼявиться потреба в audit log/аналітиці на основі повної історії подій замовлення |

**Найбільший ризик мого вибору:** один Postgres-інстанс під усім
навантаженням модульного моноліту — конкурентні декременти `stock` під час
пікових замовлень можуть вичерпати connection pool і сповільнити навіть
незв'язані запити каталогу («шумний сусід»).

**Як я помічу, що помилився:** зростання p95 latency `GET /products`
корелює з навантаженням на `POST /orders` (моніторинг per-endpoint latency
+ Postgres connection pool usage) — сигнал, що читання каталогу варто
виокремити (репліка на читання або окремий сервіс).

---

## Журнал рішень

### 2026-09-20 (ДЗ №2, `hw-11`)

Було: Express (написаний на ДЗ №1). Стало: NestJS + TypeScript.

Причина: курс — про NestJS, і подальший конфіг-скелет (`ConfigModule`, DI)
розрахований саме на нього. Контракт, cursor-пагінація, `Idempotency-Key` і
`problem+json`-помилки поведінково не змінились.

### 2026-09-22 (ДЗ №4, `hw-13`)

Було: raw-SQL схема з ДЗ №3 (`db/`), гроші — `numeric(10,2)`/`numeric(12,2)`.
Стало: та сама схема — entities + relations + міграції TypeORM
(`src/entities/`, `src/migrations/`), гроші — `integer` у мінорних
одиницях (`*_cents`), як цього прямо вимагає умова ДЗ №13. Деталі й
обґрунтування — розділ [TypeORM-шар (ДЗ №4)](#typeorm-шар-дз-4).

Секрети (`scripts/with-secrets.sh`): умова ДЗ №13 припускає, що ця
обгортка вже існує з ДЗ №11 — але фактичний ДЗ №11 у цьому репо пішов
іншим шляхом (`DB_PASSWORD_FILE` — секрет-файл, що перечитується на кожне
нове з'єднання для ротації без рестарту, розділ
[Ротація пароля БД](#ротація-пароля-бд-без-рестарту-застосунку)), Infisical
у репо не заводився. Обгортку написано з нуля саме зараз, за точною
специфікацією з умови ДЗ №13, — основний шлях веде у сховище
(`infisical run`), `SKIP_VAULT=1` лишається аварійним входом для грейдера
(п.8 умови), а не основним способом роботи.

---

## Реалізація

Технічні деталі того, що вже зроблено по кожному ДЗ курсового.

- ДЗ №1 (`hw-09`): OpenAPI-контракт (`/products`, `/orders`) і рантайм-валідація
  на кордоні — **варіант Б**.
- ДЗ №2 (`hw-11`): конфігурація застосунку — zod-схема з fail-fast, `.env.example`,
  секрети поза git/образом, ротація пароля БД без рестарту. Деталі — розділ
  [Configuration](#configuration) нижче.
- ДЗ №3 (`hw-12`): дата-шар — схема (`db/schema.sql`), seed на 100 000+ рядків
  (`db/seed.sql`), 4 повільні запити з доказом прискорення через індекси
  (`db/queries/`, `db/indexes.sql`, `db/OPTIMIZATIONS.md`), включно з
  повнотекстовим пошуком по каталогу (GIN по `tsvector`). Деталі — розділ
  [Дата-шар (ДЗ №3)](#дата-шар-дз-3) нижче.
- ДЗ №4 (`hw-13`): та сама схема — тепер через TypeORM. Entities + relations
  (`src/entities/`), міграції замість `synchronize` (`src/migrations/`),
  ідемпотентний seed (`src/seed.ts`), N+1 доведено й вилікувано
  (`src/demo-nplus1.ts`), звіт через `QueryBuilder` (`src/report.ts`).
  Деталі — розділ [TypeORM-шар (ДЗ №4)](#typeorm-шар-дз-4) нижче.

### Обраний варіант (ДЗ №1, частина 5)

**Варіант Б: `express-openapi-validator`.**

Застосунок (`src/`) підвантажує `openapi/openapi.yaml` і валідує кожен запит
та кожну відповідь проти спеки (`validateRequests: true`,
`validateResponses: true`). Помилки валідатора (`src/common/openapi-error-handler.ts`)
та власні помилки бізнес-логіки, що виникають у контролерах Nest
(`src/common/all-exceptions.filter.ts`), перетворюються у
`application/problem+json` з полями `type/title/status/detail/instance`.

Дані — in-memory (`ProductsService`, `OrdersService`), без бази.

### Структура

```
openapi/openapi.yaml         # спека: 2 ресурси, 5 операцій, cursor-пагінація,
                              # Idempotency-Key, problem+json
src/
  main.ts                    # bootstrap: express-openapi-validator middleware + global filters
  app.module.ts
  config/
    env.schema.ts               # zod-схема process.env + validate() (fail-fast)
  database/
    database.service.ts         # pg.Pool, пароль — функція, що перечитує secrets/db_password
    database.module.ts
  health/
    health.controller.ts        # GET /health — реальний SELECT 1 + uptime
    health.module.ts
  products/
    products.controller.ts
    products.service.ts        # in-memory каталог
    products.module.ts
  orders/
    orders.controller.ts       # включно з Idempotency-Key семантикою
    orders.service.ts          # in-memory замовлення + idempotency-store
    orders.module.ts
  common/
    types.ts                   # Product/Order/OrderItem
    errors.ts                  # HttpError-підкласи (400/404/422)
    pagination.ts               # opaque cursor (base64) encode/decode
    problem-json.ts             # спільний форматер application/problem+json
    all-exceptions.filter.ts    # Nest ExceptionFilter — помилки контролерів/сервісів
    openapi-error-handler.ts    # Express error-middleware — помилки express-openapi-validator
scripts/
  check-spec.js               # перевірка обсягу OpenAPI-спеки
  check-env-example.mjs       # звірка .env.example зі схемою (check:env)
.env.example                 # контракт змінних середовища (реальний .env — у .gitignore)
secrets/db_password           # файл-секрет пароля БД (у .gitignore)
rotate.sh                    # ротація пароля БД без рестарту застосунку
docker-compose.yml            # Postgres для локального запуску
Dockerfile / .dockerignore    # образ без секретів у шарах
```

### Встановлення

```
npm install
```

### Configuration

Усі змінні середовища описані однією zod-схемою (`src/config/env.schema.ts`) і
перевіряються на старті через `ConfigModule.forRoot({ validate })` — до того,
як Nest почне будувати DI-граф. Якщо змінної немає або вона невалідна, процес
одразу завершується (`process.exit(1)`) зі списком **усіх** зламаних змінних
одразу, а не по одній. У коді немає жодного прямого читання `process.env` —
тільки типізований `ConfigService<Env, true>`.

#### Змінні середовища

| Змінна | Обов'язкова | Default | Джерело | Призначення |
|---|---|---|---|---|
| `NODE_ENV` | ні | `development` | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | `development` \| `production` \| `test` |
| `PORT` | ні | `3000` | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | HTTP-порт застосунку |
| `DB_HOST` | так | — | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | Хост Postgres |
| `DB_PORT` | ні | `5432` | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | Порт Postgres |
| `DB_NAME` | так | — | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | Назва бази |
| `DB_USER` | так | — | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | Роль Postgres |
| `DB_PASSWORD_FILE` | так | — | сховище ДЗ №2/#11: `.env` (dev) / оточення оркестрації (prod) | Шлях до файлу з паролем (не сам пароль!) |
| `DATABASE_URL` | так | — | **сховище ДЗ №2/#11:** `.env` (dev; контракт і фейковий пароль — у `.env.example`) / секрети оркестрації (prod). Окремого env-файлу під нього немає | Один рядок підключення до бази ДЗ №3 — для `psql`/тулінгу. Сам застосунок його не використовує — він підключається через `DB_HOST`+... вище (це і дає ротацію пароля без рестарту) |

Реальний пароль ніколи не живе в env — лише шлях до файлу-секрету
(`secrets/db_password`, поза git). `pg.Pool` отримує пароль через функцію,
яка перечитує цей файл на кожне **нове** з'єднання (`src/database/database.service.ts`) —
це і робить ротацію без рестарту можливою.

#### Локальний запуск

```
cp .env.example .env          # підлаштуй значення під себе
docker compose up -d          # піднімає Postgres (POSTGRES_USER/PASSWORD/DB
                               # мають збігатись зі значенням у secrets/db_password)
npm start                     # build + node dist/main.js
```

`npm run check:env` — звіряє `.env.example` зі схемою (падає з exit 1, якщо
файл відстав від схеми).

#### Ротація пароля БД (без рестарту застосунку)

```
curl http://localhost:3000/health      # запам'ятай uptime
bash rotate.sh                         # ALTER ROLE -> оновлює secrets/db_password -> pg_terminate_backend
curl http://localhost:3000/health      # 200, uptime БІЛЬШИЙ за попередній — процес не перезапускався
```

Що відбувається всередині `rotate.sh`, у порядку виконання:

1. `ALTER ROLE ... WITH PASSWORD` — новий пароль одразу дійсний у Postgres.
2. Файл `secrets/db_password` оновлюється **одразу після** цього — з цього
   моменту нові з'єднання пулу читають новий пароль (старі — ще працюють на
   вже встановлених з'єднаннях, авторизація там уже відбулась раніше).
3. `pg_terminate_backend(...)` розриває старі з'єднання, змушуючи пул
   відкрити нові — саме вони й перечитають оновлений файл.

Пул підписаний на `pool.on('error', ...)`: коли Postgres розриває з'єднання
командою адміністратора, пул емітить `'error'` — без обробника процес впав би
з необробленим винятком. Це очікувана частина механізму ротації, не баг.

**Пастка, про яку варто пам'ятати:** `docker-compose.yml` задає стартовий
пароль Postgres (`POSTGRES_PASSWORD`), який має збігатись зі стартовим вмістом
`secrets/db_password`. Після `docker compose down -v` (скидання volume)
Postgres повертається до цього стартового пароля, а файл `secrets/db_password`
лишається з ротованим значенням від попереднього тесту. Якщо після цього
застосунок не може підключитись (`password authentication failed`) — поверни
`secrets/db_password` до стартового значення вручну.

#### Секрети поза git і поза Docker-образом

```
git check-ignore .env                              # -> .env
docker build -t myapp .
docker run --rm myapp ls -a /app                    # є .env.example, немає .env і secrets/
docker run --rm myapp sh -c 'cat /app/.env'; echo $? # No such file or directory, exit 1
docker inspect --format '{{.Config.Env}}' myapp     # лише PATH/NODE_VERSION/YARN_VERSION базового образу
docker history --no-trunc myapp | grep -i password  # порожньо
```

## Дата-шар (ДЗ №3)

Схема, seed на реалістичний обсяг і докази прискорення чотирьох запитів
через індекси — усе в `db/`. Головна таблиця (для обсягу ≥100 000):
**`orders`**. Таблиця, по якій шукає q4 (повнотекстовий пошук): **`products`**
(теж ≥100 000).

```
db/schema.sql          # users, products (+ генерована search_vector), orders, order_items
db/seed.sql             # >=100k orders, >=100k products, перекошені розподіли, VACUUM (ANALYZE)
db/queries/q1.sql       # orders за buyer_id + період
db/queries/q2.sql       # orders зі status = 'pending'
db/queries/q3.sql       # users за lower(email) — логін без регістру
db/queries/q4.sql       # повнотекстовий пошук products (plainto_tsquery)
db/indexes.sql           # 4 індекси — по одному на запит, включно з GIN
db/OPTIMIZATIONS.md      # EXPLAIN до/після на всі 4 + секція "Морфологія"
```

**Підняти базу** (свіжий клон, без правок файлів):

```
docker compose up -d --wait
```

**Підключитись:**

```
docker compose exec postgres psql -U marketplace_app -d marketplace
```

(дефолтні дев-креденшели контейнера лежать прямо в `docker-compose.yml`;
окремого `secrets/db_password.example` не потрібно. Це окремий шлях для
локального стенда/грейдера зі свіжого клона — він не є джерелом
`DATABASE_URL`: застосунок бере підключення зі сховища, див. таблицю
[Configuration](#configuration).)

Повний цикл перевірки (той самий, який виконує грейдер):

```
docker compose down -v && docker compose up -d --wait
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql
psql "$DATABASE_URL" -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"   # ...і так для q2, q3, q4 — має бути Seq Scan
psql "$DATABASE_URL" -f db/indexes.sql
psql "$DATABASE_URL" -c "ANALYZE;"
psql "$DATABASE_URL" -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q1.sql)"   # ...і так для q2, q3, q4 — Seq Scan має зникнути
```

Деталі — усі 4 пари EXPLAIN до/після, пояснення і секція «Морфологія» — у
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

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

### Свідомий редизайн проти db/schema.sql (ДЗ №3)

Гроші — `integer` у мінорних одиницях (`price_cents`, `total_amount_cents`,
`unit_price_cents`), не `numeric`/`float`, як цього прямо вимагає ДЗ №13
(і як домен уже описував їх у розділі [2. Домен](#2-домен) —
`price_cents`/`total_cents` там були задекларовані ще на ДЗ №0). `PRIMARY
KEY` — `bigint` (значення повертаються як `string` у TS, щоб не впертися в
межу `Number` на великих ID/агрегатах).

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

### Перевірки — ДЗ №1 (acceptance criteria)

Усі команди нижче виконуються після `npm install`, без ручних кроків.

#### 1. Спека валідна

```
npx @redocly/cli lint openapi/openapi.yaml
```

Очікується exit code 0 (дозволені лише warnings). У спеці є `security: []` на
корені саме для правила `security-defined`.

#### 2. Обсяг спеки: ≥2 ресурси, ≥5 операцій, Idempotency-Key required + опис ≥40 символів

```
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

Або коротко: `npm run check:openapi` (робить те саме через `scripts/check-spec.js`).

Фактичний результат: `операцій: 5 · ресурсів: 2` · `required = true` · `опис, символів = 373`.

#### 3. Idempotency-Key задекларовано

```
grep -c "Idempotency-Key" openapi/openapi.yaml
```

`≥ 1` (header-параметр на `POST /orders`, `required: true`, з описом семантики
повтору того самого ключа + тіла).

#### 4. Cursor-пагінація в контракті

```
grep -c "next_cursor" openapi/openapi.yaml
```

`≥ 1`. `GET /products` і `GET /orders` мають query-параметри `limit`/`cursor`,
відповідь — `{ items, next_cursor }`, `next_cursor` — `nullable`.

#### 5. problem+json скрізь у помилках

```
grep -c "application/problem+json" openapi/openapi.yaml
```

`≥ 2`. Схема `Problem` у `components.schemas` з обов'язковими
`type/title/status/detail/instance`.

#### 6. Contract-частина (варіант Б) — сервер справді відхиляє все, що суперечить спеці

```
npm start
```

В іншому терміналі:

```
# без Idempotency-Key -> 400 problem+json
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"product_id\":\"prod_1\",\"quantity\":1}]}"
# detail: "request/headers must have required property 'idempotency-key'"

# порожні items -> 400 problem+json
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k1" \
  -d "{\"items\":[]}"
# detail: "request/body/items must NOT have fewer than 1 items"

# валідний запит -> 201
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k2" \
  -d "{\"items\":[{\"product_id\":\"prod_1\",\"quantity\":1}]}"
```

Додатково (список і карточка ресурсу):

```
curl http://localhost:3000/products?limit=2
curl -i http://localhost:3000/products/does-not-exist   # 404 problem+json
curl http://localhost:3000/orders/order_1
```

### Додатковий виклик (реалізовано, без балів)

Повна семантика `Idempotency-Key`:

```
# повтор того самого ключа + того самого тіла -> той самий 201 + Idempotency-Replay: true
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k2" \
  -d "{\"items\":[{\"product_id\":\"prod_1\",\"quantity\":1}]}"

# той самий ключ, інше тіло -> 422 problem+json
curl -i -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" -H "Idempotency-Key: k2" \
  -d "{\"items\":[{\"product_id\":\"prod_2\",\"quantity\":1}]}"
```

Реалізація — `idempotencyStore` (Map) у `OrdersService` (`src/orders/orders.service.ts`):
ключ + sha256-хеш тіла запиту; той самий ключ+хеш повертає збережену відповідь
із заголовком `Idempotency-Replay: true`; той самий ключ з іншим хешем -> `422`
з `UnprocessableEntityError`.

### Перевірки — ДЗ №2 (acceptance criteria)

#### 1. Fail-fast без обов'язкової змінної

```
mv .env /tmp
env -u DB_HOST npm run start
echo $?
mv /tmp/.env .
```

Процес завершується з exit code ≠ 0, у виводі — назва зламаної змінної
(`DB_HOST`) і причина.

#### 2. `.env.example` синхронний зі схемою

```
npm run check:env          # exit 0
# видалити рядок з .env.example, повторити
npm run check:env          # exit 1
```

#### 3. Секрет не в git

```
git check-ignore .env                                   # -> .env
git status --ignored --porcelain | grep -E '^!! .*\.env$' # знаходить рядок
git ls-files | grep -c '\.env$'                          # 0
```

#### 4. Секрет не в Docker-образі

```
docker build -t myapp .
docker run --rm myapp ls -a /app
docker run --rm myapp sh -c 'cat /app/.env'
docker inspect --format '{{.Config.Env}}' myapp
docker history --no-trunc myapp | grep -i password
```

Деталі очікуваного результату кожної команди — у розділі
[Configuration](#configuration) вище.

#### 5. Ротація без рестарту

```
docker compose up -d
npm start
curl http://localhost:3000/health
bash rotate.sh
curl http://localhost:3000/health
```

`uptime` у другому виклику — більший за перший; процес не перезапускався.

### Перевірки — ДЗ №3 (acceptance criteria)

Повний цикл — див. [Дата-шар (ДЗ №3)](#дата-шар-дз-3) вище. Точкові
перевірки:

```
# схема + FK
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';"   # >= 3

# обсяг
psql "$DATABASE_URL" -f db/seed.sql
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM orders;"     # >= 100000
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM products;"   # >= 100000

# після індексів: жоден не мертвий
psql "$DATABASE_URL" -f db/indexes.sql && psql "$DATABASE_URL" -c "ANALYZE;"
# ...прогнати всі 4 EXPLAIN (ANALYZE, BUFFERS), потім:
psql "$DATABASE_URL" -Atc "SELECT indexrelname FROM pg_stat_user_indexes WHERE schemaname='public' AND idx_scan = 0 AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE conindid <> 0);"   # порожньо

# partial/expression присутній (не GIN)
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef NOT ILIKE '%USING gin%' AND (indexdef ILIKE '% WHERE %' OR indexdef ~ '\((\w+)\(');"   # >= 1

# пошуковий індекс — GIN по tsvector
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass o ON o.oid=i.indclass[0] WHERE am.amname='gin' AND o.opcintype='tsvector'::regtype;"   # >= 1
```

Фактичний результат на цій машині: FK = 4, `orders` = 110 000, `products` =
120 000, мертвих індексів = 0, partial/expression = 2
(`idx_orders_pending_created`, `idx_users_email_lower`), GIN-по-tsvector = 1.
Повні EXPLAIN — у [`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

### Версії, на яких перевірено

`@redocly/cli 2.46.0`, `@nestjs/core 10.4.20`, `@nestjs/config 3.3.0`,
`express 4.22.2`, `express-openapi-validator 5.6.2`, `zod 4.6.5`, `pg 8.23.0`,
`typescript 7.0.2`, `typeorm 0.3.31` (Node 20.12.1).

> `@nestjs/*` пришпилені на v10: у v11+ `@nestjs/platform-express` тягне за
> собою Express 5, а `express-openapi-validator@5.6.2` найнадійніше працює
> саме з Express 4.

> `typeorm` пришпилений на `0.3.31` (dist-tag `legacy`), не на `latest`
> (`1.x`): `typeorm@1.x` вимагає Node `^20.19.0 || ^22.13.0 || >=24.11.0`,
> тут — Node `20.12.1`. `0.3.31` вимагає лише `>=16.13.0`.
