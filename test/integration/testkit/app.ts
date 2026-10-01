import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TestDb } from './postgres';

/**
 * Піднімає ПОВНИЙ застосунок (AppModule без підмін провайдерів) проти
 * контейнера БД і застосовує ту саму конфігурацію, що й main.ts.
 * AppModule імпортується через require ПІСЛЯ виставлення env: ConfigModule.forRoot
 * читає оточення в момент завантаження модуля.
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
