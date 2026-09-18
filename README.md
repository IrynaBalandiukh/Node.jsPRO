# hw-09 — Marketplace API contract (OpenAPI) + runtime validation

Курсове ДЗ №1: OpenAPI-контракт для Marketplace API (`/products`, `/orders`) і
частина 5 у **варіанті Б** — рантайм-валідатор на кордоні.

## Обраний варіант

**Варіант Б: `express-openapi-validator`.**

Мінімальний Express-сервер (`src/`) підвантажує `openapi/openapi.yaml` і валідує
кожен запит та кожну відповідь проти спеки (`validateRequests: true`,
`validateResponses: true`). Помилки валідатора та власні помилки бізнес-логіки
(404 / 422) перетворюються одним error-handler'ом (`src/app.js`) у
`application/problem+json` з полями `type/title/status/detail/instance`.

Дані — in-memory (`src/data.js`), без бази.

## Структура

```
openapi/openapi.yaml   # спека: 2 ресурси, 5 операцій, cursor-пагінація,
                        # Idempotency-Key, problem+json
src/
  app.js                # Express app + express-openapi-validator + error-handler
  server.js              # запуск сервера
  data.js                 # in-memory продукти/замовлення + idempotency-store
  pagination.js           # opaque cursor (base64) encode/decode
  errors.js               # HttpError-підкласи (400/404/422)
scripts/check-spec.js      # скрипт перевірки обсягу спеки (операції/ресурси/Idempotency-Key)
```

## Встановлення

```
npm install
```

## Запуск сервера

```
npm start
```

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

Реалізація — `idempotencyStore` (Map) у `src/data.js`: ключ + sha256-хеш тіла
запиту; той самий ключ+хеш повертає збережену відповідь із заголовком
`Idempotency-Replay: true`; той самий ключ з іншим хешем -> `422` з
`UnprocessableEntityError`.

## Версії, на яких перевірено

`@redocly/cli 2.46.0`, `express 4.22.2`, `express-openapi-validator 5.6.2` (Node 20.12.1).
