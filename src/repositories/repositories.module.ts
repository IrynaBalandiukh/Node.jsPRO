import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NestOrdersRepository } from './orders.repository';
import { NestProductsRepository } from './products.repository';
import { NestUsersRepository } from './users.repository';
import { RepositoriesFactory } from './repositories.factory';

@Module({
  imports: [DatabaseModule],
  providers: [NestUsersRepository, NestProductsRepository, NestOrdersRepository, RepositoriesFactory],
  exports: [NestUsersRepository, NestProductsRepository, NestOrdersRepository, RepositoriesFactory],
})
export class RepositoriesModule {}
