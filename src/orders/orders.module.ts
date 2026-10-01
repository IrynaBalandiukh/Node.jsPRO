import { Module } from '@nestjs/common';
import { RepositoriesModule } from '../repositories/repositories.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
