import { PG_CHECK_VIOLATION, PG_FOREIGN_KEY_VIOLATION } from '../../src/repositories/queryable';
import { ProductsRepository } from '../../src/repositories/products.repository';
import { UsersRepository } from '../../src/repositories/users.repository';
import { aProduct, aSeller } from './testkit/builders';
import { startTestDb, TestDb } from './testkit/postgres';

describe('ProductsRepository (real Postgres)', () => {
  let db: TestDb;
  let products: ProductsRepository;
  let sellerId: string;

  beforeAll(async () => {
    db = await startTestDb();
    products = new ProductsRepository(db.pool);
  });
  afterAll(async () => {
    await db.stop();
  });
  beforeEach(async () => {
    await db.reset();
    sellerId = (await new UsersRepository(db.pool).create(aSeller())).id;
  });

  it('creates a product and reads it back by id', async () => {
    const created = await products.create(aProduct(sellerId, { name: 'Keyboard', priceCents: 8999, stock: 12 }));

    expect(await products.findById(created.id)).toEqual({
      id: created.id,
      name: 'Keyboard',
      description: 'A test product',
      price_cents: 8999,
      stock: 12,
    });
  });

  it('returns null for an unknown or malformed id instead of throwing', async () => {
    expect(await products.findById('999999')).toBeNull();
    expect(await products.findById('not-a-number')).toBeNull();
  });

  it('rejects a product whose seller does not exist (foreign key, 23503)', async () => {
    await expect(products.create(aProduct('424242'))).rejects.toMatchObject({
      code: PG_FOREIGN_KEY_VIOLATION,
    });
  });

  it('rejects a non-positive price (CHECK constraint, 23514)', async () => {
    await expect(products.create(aProduct(sellerId, { priceCents: 0 }))).rejects.toMatchObject({
      code: PG_CHECK_VIOLATION,
    });
  });

  it('lists newest first and paginates with limit/offset', async () => {
    const a = await products.create(aProduct(sellerId));
    const b = await products.create(aProduct(sellerId));
    const c = await products.create(aProduct(sellerId));

    const firstPage = await products.list(2, 0);
    const secondPage = await products.list(2, 2);

    expect(firstPage.map((p) => p.id)).toEqual([c.id, b.id]);
    expect(secondPage.map((p) => p.id)).toEqual([a.id]);
  });

  it('decrementStock is an atomic check-and-update: never goes below zero', async () => {
    const { id } = await products.create(aProduct(sellerId, { stock: 3 }));

    expect(await products.decrementStock(id, 2)).toBe(true);
    expect(await products.decrementStock(id, 2)).toBe(false); // лишилось 1
    expect((await products.findById(id))!.stock).toBe(1);
  });
});
