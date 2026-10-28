import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { Pool, PoolClient } from 'pg';
import { Env } from '../config/env.schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const passwordFile = this.configService.get('DB_PASSWORD_FILE', {
      infer: true,
    });

    this.pool = new Pool({
      host: this.configService.get('DB_HOST', { infer: true }),
      port: this.configService.get('DB_PORT', { infer: true }),
      database: this.configService.get('DB_NAME', { infer: true }),
      user: this.configService.get('DB_USER', { infer: true }),
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
    });

    this.pool.on('error', (err) => {
      this.logger.warn(
        `Postgres pool connection error (will reconnect): ${err.message}`,
      );
    });
  }

  /** Runs `fn` on one connection inside BEGIN/COMMIT; any throw rolls everything back. */
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
