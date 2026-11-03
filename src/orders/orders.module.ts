import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { OrderEventsPublisher } from '../messaging/publisher';
import { OrderEventsService } from './order-events.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';

@Module({
  imports: [DatabaseModule, RepositoriesModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsService, OrdersGateway, OrderEventsPublisher],
})
export class OrdersModule {}
