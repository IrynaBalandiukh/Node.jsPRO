import * as fs from 'node:fs';
import * as path from 'node:path';
import { json } from 'express';
import * as swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import * as OpenApiValidator from 'express-openapi-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { openApiErrorHandler } from './common/openapi-error-handler';

// The spec lives in <root>/openapi; the number of levels up differs between
// src/ (ts-node), dist/ (tsc) and dist-test/src/ (test build).
function resolveSpecPath(): string {
  for (const up of ['..', '../..']) {
    const candidate = path.join(__dirname, up, 'openapi', 'openapi.yaml');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('openapi/openapi.yaml not found');
}

/**
 * The single app configuration (Swagger UI, body parser, OpenAPI validation,
 * error filter). Both main.ts and the E2E/contract tests call it, so the tests
 * exercise the same app that ships. The app must be created with
 * `bodyParser: false`.
 */
export function configureApp(app: NestExpressApplication): void {
  const apiSpec = resolveSpecPath();

  // Swagger UI is generated straight from openapi.yaml at startup, so the docs
  // can never drift from the contract. Mounted before the validator.
  const openApiDocument = parseYaml(fs.readFileSync(apiSpec, 'utf8'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec,
      validateRequests: true,
      validateResponses: true,
      // /health and /docs (Swagger UI) are operational infrastructure, not
      // Marketplace API resources - they aren't part of the OpenAPI contract.
      ignorePaths: /^\/(health|docs)/,
    }),
  );
  app.use(openApiErrorHandler);
  app.useGlobalFilters(new AllExceptionsFilter());
}
