import { Injectable } from '@nestjs/common';
import { OrdersRepository } from './orders.repository';
import { ProductsRepository } from './products.repository';
import { Queryable } from './queryable';

export interface TransactionalRepositories {
  products: ProductsRepository;
  orders: OrdersRepository;
}

// Builds repositories on top of a given connection (e.g. a transaction's
// client), so services get them through DI instead of calling `new`.
@Injectable()
export class RepositoriesFactory {
  forClient(db: Queryable): TransactionalRepositories {
    return { products: new ProductsRepository(db), orders: new OrdersRepository(db) };
  }
}
