import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { Env } from '../config/env.schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const passwordFile = this.configService.get('DB_PASSWORD_FILE', { infer: true });

    this.pool = new Pool({
      host: this.configService.get('DB_HOST', { infer: true }),
      port: this.configService.get('DB_PORT', { infer: true }),
      database: this.configService.get('DB_NAME', { infer: true }),
      user: this.configService.get('DB_USER', { infer: true }),
      // Re-read on every new connection instead of once at startup — this is
      // what makes password rotation possible without restarting the process.
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
    });

    // rotate.sh terminates existing backends via pg_terminate_backend after
    // rotating the password. The pool then emits 'error' for the killed idle
    // connection — without this handler that error is unhandled and crashes
    // the process. This is not a bug in rotation, it's a required handler.
    this.pool.on('error', (err) => {
      this.logger.warn(`Postgres pool connection error (will reconnect): ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
