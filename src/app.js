const path = require('path');
const crypto = require('crypto');
const express = require('express');
const OpenApiValidator = require('express-openapi-validator');

const { products, orders, findProduct, findOrder, createOrder, idempotencyStore } = require('./data');
const { paginate } = require('./pagination');
const { NotFoundError, UnprocessableEntityError } = require('./errors');

const STATUS_TITLES = {
  400: 'Bad Request',
  404: 'Not Found',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

function createApp() {
  const app = express();
  app.use(express.json());

  const apiSpec = path.join(__dirname, '..', 'openapi', 'openapi.yaml');

  app.use(
    OpenApiValidator.middleware({
      apiSpec,
      validateRequests: true,
      validateResponses: true,
    }),
  );

  app.get('/products', (req, res) => {
    const { limit, cursor } = req.query;
    res.json(paginate(products, { limit: limit ? Number(limit) : undefined, cursor }));
  });

  app.get('/products/:productId', (req, res) => {
    const product = findProduct(req.params.productId);
    if (!product) {
      throw new NotFoundError(`Product '${req.params.productId}' was not found`);
    }
    res.json(product);
  });

  app.get('/orders', (req, res) => {
    const { limit, cursor } = req.query;
    res.json(paginate(orders, { limit: limit ? Number(limit) : undefined, cursor }));
  });

  app.get('/orders/:orderId', (req, res) => {
    const order = findOrder(req.params.orderId);
    if (!order) {
      throw new NotFoundError(`Order '${req.params.orderId}' was not found`);
    }
    res.json(order);
  });

  app.post('/orders', (req, res) => {
    // express-openapi-validator lowercases header names on req.headers
    const idempotencyKey = req.headers['idempotency-key'];
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

    const stored = idempotencyStore.get(idempotencyKey);
    if (stored) {
      if (stored.bodyHash !== bodyHash) {
        throw new UnprocessableEntityError(
          `Idempotency-Key '${idempotencyKey}' was already used with a different request body`,
        );
      }
      res.set('Idempotency-Replay', 'true');
      return res.status(stored.status).json(stored.body);
    }

    const { order, error } = createOrder(req.body.items);
    if (error === 'product_not_found') {
      throw new NotFoundError('One or more products referenced in items do not exist');
    }

    idempotencyStore.set(idempotencyKey, { bodyHash, status: 201, body: order });
    res.status(201).json(order);
  });

  // express-openapi-validator errors (missing/invalid params, headers, body)
  // and the HttpError subclasses thrown above both land here.
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).type('application/problem+json').json({
      type: 'about:blank',
      title: STATUS_TITLES[status] || 'Error',
      status,
      detail: err.message || 'Unexpected error',
      instance: req.originalUrl,
    });
  });

  return app;
}

module.exports = { createApp };
