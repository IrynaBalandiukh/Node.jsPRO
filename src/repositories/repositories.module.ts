import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NestOrdersRepository } from './orders.repository';
import { NestProductsRepository } from './products.repository';
import { NestUsersRepository } from './users.repository';

@Module({
  imports: [DatabaseModule],
  providers: [NestUsersRepository, NestProductsRepository, NestOrdersRepository],
  exports: [NestUsersRepository, NestProductsRepository, NestOrdersRepository],
})
export class RepositoriesModule {}
