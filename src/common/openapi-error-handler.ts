import { ErrorRequestHandler } from 'express';
import { buildProblem } from './problem-json';

// Registered via app.use() directly after the OpenApiValidator middleware in
// main.ts (and before Nest's own routes are attached at listen() time), so
// Express routes any next(err) call from the validator here first.
export const openApiErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err.status || 500;
  res
    .status(status)
    .type('application/problem+json')
    .json(buildProblem(status, err.message || 'Unexpected error', req.originalUrl));
};
