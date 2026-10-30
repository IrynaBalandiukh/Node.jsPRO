import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';
import { paginateQuery, Page } from '../common/pagination';
import { NotFoundError } from '../common/errors';
import { Product } from '../common/types';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<Product>> {
    return paginateQuery((l, o) => this.productsService.findAll(l, o), {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':productId')
  async getById(@Param('productId') productId: string): Promise<Product> {
    const product = await this.productsService.findById(productId);
    if (!product) {
      throw new NotFoundError(`Product '${productId}' was not found`);
    }
    return product;
  }
}
