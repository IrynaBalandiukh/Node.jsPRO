import * as fs from 'node:fs';
import * as path from 'node:path';
import { json } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { openApiErrorHandler } from './common/openapi-error-handler';

// Спека лежить у <root>/openapi: з src/ (ts-node), з dist/ (tsc) і з
// dist-test/src/ (збірка тестів) до кореня різна кількість кроків угору.
function resolveSpecPath(): string {
  for (const up of ['..', '../..']) {
    const candidate = path.join(__dirname, up, 'openapi', 'openapi.yaml');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('openapi/openapi.yaml not found');
}

/**
 * Єдина конфігурація застосунку (body parser, OpenAPI-валідація, фільтр
 * помилок). Її викликають і main.ts, і E2E/contract-тести — тому тести
 * перевіряють саме той застосунок, що їде в прод. Застосунок має бути
 * створений з `bodyParser: false`.
 */
export function configureApp(app: NestExpressApplication): void {
  app.use(json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: resolveSpecPath(),
      validateRequests: true,
      validateResponses: true,
      // /health is operational infrastructure, not a Marketplace API
      // resource — it isn't part of the OpenAPI contract.
      ignorePaths: /^\/health/,
    }),
  );
  app.use(openApiErrorHandler);
  app.useGlobalFilters(new AllExceptionsFilter());
}
