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

---

## Реалізація

Технічні деталі того, що вже зроблено по кожному ДЗ курсового.

- ДЗ №1 (`hw-09`): OpenAPI-контракт (`/products`, `/orders`) і рантайм-валідація
  на кордоні — **варіант Б**.
- ДЗ №2 (`hw-11`): конфігурація застосунку — zod-схема з fail-fast, `.env.example`,
  секрети поза git/образом, ротація пароля БД без рестарту. Деталі — розділ
  [Configuration](#configuration) нижче.

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

| Змінна | Обов'язкова | Default | Призначення |
|---|---|---|---|
| `NODE_ENV` | ні | `development` | `development` \| `production` \| `test` |
| `PORT` | ні | `3000` | HTTP-порт застосунку |
| `DB_HOST` | так | — | Хост Postgres |
| `DB_PORT` | ні | `5432` | Порт Postgres |
| `DB_NAME` | так | — | Назва бази |
| `DB_USER` | так | — | Роль Postgres |
| `DB_PASSWORD_FILE` | так | — | Шлях до файлу з паролем (не сам пароль!) |

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

### Версії, на яких перевірено

`@redocly/cli 2.46.0`, `@nestjs/core 10.4.20`, `@nestjs/config 3.3.0`,
`express 4.22.2`, `express-openapi-validator 5.6.2`, `zod 4.6.5`, `pg 8.23.0`,
`typescript 7.0.2` (Node 20.12.1).

> `@nestjs/*` пришпилені на v10: у v11+ `@nestjs/platform-express` тягне за
> собою Express 5, а `express-openapi-validator@5.6.2` найнадійніше працює
> саме з Express 4.
