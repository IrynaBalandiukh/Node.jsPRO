import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { paginate, Page } from '../common/pagination';
import { NotFoundError } from '../common/errors';
import { Product } from '../common/types';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Page<Product> {
    return paginate(this.productsService.findAll(), {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':productId')
  getById(@Param('productId') productId: string): Product {
    const product = this.productsService.findById(productId);
    if (!product) {
      throw new NotFoundError(`Product '${productId}' was not found`);
    }
    return product;
  }
}
