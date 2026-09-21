import { Injectable } from '@nestjs/common';
import { Product } from '../common/types';

@Injectable()
export class ProductsService {
  private readonly products: Product[] = [
    { id: 'prod_1', name: 'Mechanical Keyboard', description: 'Hot-swappable 75% keyboard', price_cents: 8999, stock: 12 },
    { id: 'prod_2', name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', price_cents: 2500, stock: 40 },
    { id: 'prod_3', name: 'USB-C Dock', description: '10-port docking station', price_cents: 14999, stock: 5 },
  ];

  findAll(): Product[] {
    return this.products;
  }

  findById(id: string): Product | undefined {
    return this.products.find((p) => p.id === id);
  }
}
