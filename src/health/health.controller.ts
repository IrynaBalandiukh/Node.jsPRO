import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseService: DatabaseService) {}

  @Get()
  async check() {
    await this.databaseService.pool.query('SELECT 1');
    return {
      status: 'ok',
      uptime: process.uptime(),
    };
  }
}
