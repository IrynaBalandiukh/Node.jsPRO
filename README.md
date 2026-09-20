# Marketplace API

Курсовий проєкт: Marketplace API на **NestJS + TypeScript**.

- ДЗ №1 (`hw-09`): OpenAPI-контракт (`/products`, `/orders`) і рантайм-валідація
  на кордоні — **варіант Б**.
- ДЗ №2 (`hw-11`): конфігурація застосунку — zod-схема з fail-fast, `.env.example`,
  секрети поза git/образом, ротація пароля БД без рестарту. Деталі — розділ
  [Configuration](#configuration) нижче.

## Обраний варіант (ДЗ №1, частина 5)

**Варіант Б: `express-openapi-validator`.**

Застосунок (`src/`) підвантажує `openapi/openapi.yaml` і валідує кожен запит
та кожну відповідь проти спеки (`validateRequests: true`,
`validateResponses: true`). Помилки валідатора (`src/common/openapi-error-handler.ts`)
та власні помилки бізнес-логіки, що виникають у контролерах Nest
(`src/common/all-exceptions.filter.ts`), перетворюються у
`application/problem+json` з полями `type/title/status/detail/instance`.

Дані — in-memory (`ProductsService`, `OrdersService`), без бази.

> Застосунок спочатку був написаний на Express (ДЗ №1); з ДЗ №2 перенесений на
> NestJS, оскільки курс — про NestJS, і весь подальший конфіг-скелет
> (`ConfigModule`, DI) розрахований саме на нього. Контракт, cursor-пагінація,
> Idempotency-Key і problem+json-помилки поведінково не змінились.

## Структура

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

## Встановлення

```
npm install
```

## Configuration

Усі змінні середовища описані однією zod-схемою (`src/config/env.schema.ts`) і
перевіряються на старті через `ConfigModule.forRoot({ validate })` — до того,
як Nest почне будувати DI-граф. Якщо змінної немає або вона невалідна, процес
одразу завершується (`process.exit(1)`) зі списком **усіх** зламаних змінних
одразу, а не по одній. У коді немає жодного прямого читання `process.env` —
тільки типізований `ConfigService<Env, true>`.

### Змінні середовища

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

### Локальний запуск

```
cp .env.example .env          # підлаштуй значення під себе
docker compose up -d          # піднімає Postgres (POSTGRES_USER/PASSWORD/DB
                               # мають збігатись зі значенням у secrets/db_password)
npm start                     # build + node dist/main.js
```

`npm run check:env` — звіряє `.env.example` зі схемою (падає з exit 1, якщо
файл відстав від схеми).

### Ротація пароля БД (без рестарту застосунку)

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

### Секрети поза git і поза Docker-образом

```
git check-ignore .env                              # -> .env
docker build -t myapp .
docker run --rm myapp ls -a /app                    # є .env.example, немає .env і secrets/
docker run --rm myapp sh -c 'cat /app/.env'; echo $? # No such file or directory, exit 1
docker inspect --format '{{.Config.Env}}' myapp     # лише PATH/NODE_VERSION/YARN_VERSION базового образу
docker history --no-trunc myapp | grep -i password  # порожньо
```

## Перевірки — ДЗ №1 (acceptance criteria)

Усі команди нижче виконуються після `npm install`, без ручних кроків.

### 1. Спека валідна

```
npx @redocly/cli lint openapi/openapi.yaml
```

Очікується exit code 0 (дозволені лише warnings). У спеці є `security: []` на
корені саме для правила `security-defined`.

### 2. Обсяг спеки: ≥2 ресурси, ≥5 операцій, Idempotency-Key required + опис ≥40 символів

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

### 3. Idempotency-Key задекларовано

```
grep -c "Idempotency-Key" openapi/openapi.yaml
```

`≥ 1` (header-параметр на `POST /orders`, `required: true`, з описом семантики
повтору того самого ключа + тіла).

### 4. Cursor-пагінація в контракті

```
grep -c "next_cursor" openapi/openapi.yaml
```

`≥ 1`. `GET /products` і `GET /orders` мають query-параметри `limit`/`cursor`,
відповідь — `{ items, next_cursor }`, `next_cursor` — `nullable`.

### 5. problem+json скрізь у помилках

```
grep -c "application/problem+json" openapi/openapi.yaml
```

`≥ 2`. Схема `Problem` у `components.schemas` з обов'язковими
`type/title/status/detail/instance`.

### 6. Contract-частина (варіант Б) — сервер справді відхиляє все, що суперечить спеці

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

## Додатковий виклик (реалізовано, без балів)

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

## Перевірки — ДЗ №2 (acceptance criteria)

### 1. Fail-fast без обов'язкової змінної

```
mv .env /tmp
env -u DB_HOST npm run start
echo $?
mv /tmp/.env .
```

Процес завершується з exit code ≠ 0, у виводі — назва зламаної змінної
(`DB_HOST`) і причина.

### 2. `.env.example` синхронний зі схемою

```
npm run check:env          # exit 0
# видалити рядок з .env.example, повторити
npm run check:env          # exit 1
```

### 3. Секрет не в git

```
git check-ignore .env                                   # -> .env
git status --ignored --porcelain | grep -E '^!! .*\.env$' # знаходить рядок
git ls-files | grep -c '\.env$'                          # 0
```

### 4. Секрет не в Docker-образі

```
docker build -t myapp .
docker run --rm myapp ls -a /app
docker run --rm myapp sh -c 'cat /app/.env'
docker inspect --format '{{.Config.Env}}' myapp
docker history --no-trunc myapp | grep -i password
```

Деталі очікуваного результату кожної команди — у розділі
[Configuration](#configuration) вище.

### 5. Ротація без рестарту

```
docker compose up -d
npm start
curl http://localhost:3000/health
bash rotate.sh
curl http://localhost:3000/health
```

`uptime` у другому виклику — більший за перший; процес не перезапускався.

## Версії, на яких перевірено

`@redocly/cli 2.46.0`, `@nestjs/core 10.4.20`, `@nestjs/config 3.3.0`,
`express 4.22.2`, `express-openapi-validator 5.6.2`, `zod 4.6.5`, `pg 8.23.0`,
`typescript 7.0.2` (Node 20.12.1).

> `@nestjs/*` пришпилені на v10: у v11+ `@nestjs/platform-express` тягне за
> собою Express 5, а `express-openapi-validator@5.6.2` найнадійніше працює
> саме з Express 4.
