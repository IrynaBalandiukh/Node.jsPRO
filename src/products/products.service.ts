import { Injectable } from '@nestjs/common';
import { Product } from '../common/types';
import { NestProductsRepository } from '../repositories/products.repository';

@Injectable()
export class ProductsService {
  constructor(private readonly products: NestProductsRepository) {}

  findAll(limit: number, offset: number): Promise<Product[]> {
    return this.products.list(limit, offset);
  }

  findById(id: string): Promise<Product | null> {
    return this.products.findById(id);
  }
}
