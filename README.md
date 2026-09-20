# Marketplace API

Курсовий проєкт: Marketplace API на **NestJS + TypeScript**.

- ДЗ №1 (`hw-09`): OpenAPI-контракт (`/products`, `/orders`) і рантайм-валідація
  на кордоні — **варіант Б**.
- ДЗ №2 (`hw-11`): конфігурація застосунку (в процесі).

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
scripts/check-spec.js        # скрипт перевірки обсягу спеки (операції/ресурси/Idempotency-Key)
```

## Встановлення

```
npm install
```

## Запуск сервера

```
npm start
```

Компілює TypeScript (`npm run build`) і запускає `dist/main.js`. Для розробки
з автоперезапуском: `npm run start:dev`.

Сервер піднімається на `http://localhost:3000`.

## Перевірки (acceptance criteria)

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

## Версії, на яких перевірено

`@redocly/cli 2.46.0`, `@nestjs/core 10.4.20`, `express 4.22.2`,
`express-openapi-validator 5.6.2`, `typescript 7.0.2` (Node 20.12.1).

> `@nestjs/*` пришпилені на v10: у v11+ `@nestjs/platform-express` тягне за
> собою Express 5, а `express-openapi-validator@5.6.2` найнадійніше працює
> саме з Express 4.
