import * as crypto from 'node:crypto';
import { NewProduct } from '../../../src/repositories/products.repository';
import { NewUser } from '../../../src/repositories/users.repository';

// Унікальний суфікс: лічильник + випадкові байти, тож дефолти не стикаються
// ні між викликами, ні між прогонами (UNIQUE(email) не спрацьовує випадково).
let seq = 0;
const uniq = () => `${++seq}-${crypto.randomBytes(3).toString('hex')}`;

export function aUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: `user-${uniq()}@example.test`,
    passwordHash: 'hash',
    role: 'buyer',
    ...overrides,
  };
}

export function aSeller(overrides: Partial<NewUser> = {}): NewUser {
  return aUser({ role: 'seller', ...overrides });
}

export function aProduct(sellerId: string, overrides: Partial<NewProduct> = {}): NewProduct {
  return {
    sellerId,
    name: `Product ${uniq()}`,
    description: 'A test product',
    priceCents: 1000,
    stock: 10,
    ...overrides,
  };
}
