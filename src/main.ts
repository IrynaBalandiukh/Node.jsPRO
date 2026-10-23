import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import { json } from "express";
import * as swaggerUi from "swagger-ui-express";
import { parse as parseYaml } from "yaml";
import * as OpenApiValidator from "express-openapi-validator";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { openApiErrorHandler } from "./common/openapi-error-handler";
import { Env } from "./config/env.schema";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const apiSpec = path.join(__dirname, "..", "openapi", "openapi.yaml");

  // Swagger UI is generated straight from openapi.yaml at startup, so the docs
  // can never drift from the contract. Mounted before the validator.
  const openApiDocument = parseYaml(fs.readFileSync(apiSpec, "utf8"));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec,
      validateRequests: true,
      validateResponses: true,
      // /health and /docs (Swagger UI) are operational infrastructure, not
      // Marketplace API resources — they aren't part of the OpenAPI contract.
      ignorePaths: /^\/(health|docs)/,
    }),
  );
  app.use(openApiErrorHandler);

  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService<Env, true>);
  const port = configService.get("PORT", { infer: true });

  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/docs`);
}

bootstrap();
