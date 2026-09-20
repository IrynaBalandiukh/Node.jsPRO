import "reflect-metadata";
import * as path from "node:path";
import { json } from "express";
import * as OpenApiValidator from "express-openapi-validator";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { openApiErrorHandler } from "./common/openapi-error-handler";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const apiSpec = path.join(__dirname, "..", "openapi", "openapi.yaml");

  app.use(json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec,
      validateRequests: true,
      validateResponses: true,
    }),
  );
  app.use(openApiErrorHandler);

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Marketplace API listening on http://localhost:${port}`);
}

bootstrap();
