import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TestDb } from './postgres';

/**
 * Boots the FULL application (AppModule without provider overrides) against
 * the DB container and applies the same configuration as main.ts.
 * AppModule is imported via require AFTER env is set: ConfigModule.forRoot
 * reads the environment when the module is loaded.
 */
export async function createTestApp(db: TestDb): Promise<NestExpressApplication> {
  db.applyAppEnv();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../../src/app.module') as typeof import('../../../src/app.module');
  const { configureApp } = require('../../../src/app.setup') as typeof import('../../../src/app.setup');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  return app;
}
