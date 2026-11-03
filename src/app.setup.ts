import * as fs from 'node:fs';
import * as path from 'node:path';
import { json } from 'express';
import * as swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import * as OpenApiValidator from 'express-openapi-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { openApiErrorHandler } from './common/openapi-error-handler';

function resolveSpecPath(): string {
  for (const up of ['..', '../..']) {
    const candidate = path.join(__dirname, up, 'openapi', 'openapi.yaml');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('openapi/openapi.yaml not found');
}

export function configureApp(app: NestExpressApplication): void {
  const apiSpec = resolveSpecPath();

  const openApiDocument = parseYaml(fs.readFileSync(apiSpec, 'utf8'));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec,
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^\/(health|docs|socket\.io)/,
    }),
  );
  app.use(openApiErrorHandler);
  app.useGlobalFilters(new AllExceptionsFilter());
}
