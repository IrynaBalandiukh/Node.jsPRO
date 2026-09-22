import 'reflect-metadata';
import AppDataSource from './data-source';
import { User, UserRole } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// Детермінований, ідемпотентний seed (ДЗ №13, п.4): фіксовані дані, без
// random()/Date.now(). Другий запуск не дублює рядки і не падає:
//  - users дедуплікуються через upsert по email (UNIQUE-констрейнт у схемі);
//  - products/orders не мають природного unique-ключа в схемі — тому
//    дедуплікуються на рівні застосунку: "чи вже є рядок з таким
//    детермінованим маркером" (ім'я товару / created_at замовлення), і
//    insert пропускається, якщо так;
//  - order_items ідуть услід за своїм order: якщо order уже існував,
//    його items наново не створюються (вони були створені разом із ним
//    при першому запуску).

interface SeedUser {
  email: string;
  passwordHash: string;
  role: UserRole;
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@seed.marketplace.dev', passwordHash: 'seed$admin$hash', role: 'admin' },
  { email: 'seller1@seed.marketplace.dev', passwordHash: 'seed$seller1$hash', role: 'seller' },
  { email: 'seller2@seed.marketplace.dev', passwordHash: 'seed$seller2$hash', role: 'seller' },
  { email: 'seller3@seed.marketplace.dev', passwordHash: 'seed$seller3$hash', role: 'seller' },
  { email: 'buyer1@seed.marketplace.dev', passwordHash: 'seed$buyer1$hash', role: 'buyer' },
  { email: 'buyer2@seed.marketplace.dev', passwordHash: 'seed$buyer2$hash', role: 'buyer' },
  { email: 'buyer3@seed.marketplace.dev', passwordHash: 'seed$buyer3$hash', role: 'buyer' },
  { email: 'buyer4@seed.marketplace.dev', passwordHash: 'seed$buyer4$hash', role: 'buyer' },
];

interface SeedProduct {
  name: string;
  description: string;
  sellerEmail: string;
  priceCents: number;
  stock: number;
  isActive: boolean;
}

const SEED_PRODUCTS: SeedProduct[] = [
  { name: 'Seed T-Shirt Basic', description: 'Бавовняна футболка, базовий крій.', sellerEmail: 'seller1@seed.marketplace.dev', priceCents: 29900, stock: 50, isActive: true },
  { name: 'Seed T-Shirt Print', description: 'Футболка з авторським принтом.', sellerEmail: 'seller1@seed.marketplace.dev', priceCents: 34900, stock: 30, isActive: true },
  { name: 'Seed Jeans Slim', description: 'Джинси зауженого крою.', sellerEmail: 'seller1@seed.marketplace.dev', priceCents: 129900, stock: 20, isActive: true },
  { name: 'Seed Sneakers Runner', description: 'Кросівки для бігу, амортизуюча підошва.', sellerEmail: 'seller2@seed.marketplace.dev', priceCents: 249900, stock: 15, isActive: true },
  { name: 'Seed Sneakers Leather', description: 'Шкіряні кросівки для щоденного носіння.', sellerEmail: 'seller2@seed.marketplace.dev', priceCents: 329900, stock: 10, isActive: true },
  { name: 'Seed Backpack Urban', description: 'Міський рюкзак, водостійка тканина.', sellerEmail: 'seller2@seed.marketplace.dev', priceCents: 189900, stock: 25, isActive: true },
  { name: 'Seed Laptop 14', description: 'Ноутбук 14", 16GB RAM, SSD 512GB.', sellerEmail: 'seller3@seed.marketplace.dev', priceCents: 3499900, stock: 8, isActive: true },
  { name: 'Seed Headphones ANC', description: 'Навушники з активним шумозаглушенням.', sellerEmail: 'seller3@seed.marketplace.dev', priceCents: 449900, stock: 40, isActive: true },
  { name: 'Seed Smartwatch Pro', description: 'Смарт-годинник з пульсометром і GPS.', sellerEmail: 'seller3@seed.marketplace.dev', priceCents: 599900, stock: 0, isActive: false },
  { name: 'Seed Book Node.js', description: 'Книга: практичний Node.js для бекенду.', sellerEmail: 'seller3@seed.marketplace.dev', priceCents: 59900, stock: 60, isActive: true },
];

interface SeedOrder {
  buyerEmail: string;
  status: OrderStatus;
  // Унікальний і детермінований на весь seed-набір — слугує ключем ідемпотентності.
  createdAt: string;
  items: Array<{ productName: string; quantity: number; unitPriceCents: number }>;
}

const SEED_ORDERS: SeedOrder[] = [
  {
    buyerEmail: 'buyer1@seed.marketplace.dev',
    status: 'paid',
    createdAt: '2026-01-05T10:00:00.000Z',
    items: [
      { productName: 'Seed T-Shirt Basic', quantity: 2, unitPriceCents: 29900 },
      { productName: 'Seed Jeans Slim', quantity: 1, unitPriceCents: 129900 },
    ],
  },
  {
    buyerEmail: 'buyer1@seed.marketplace.dev',
    status: 'pending',
    createdAt: '2026-01-12T14:30:00.000Z',
    items: [{ productName: 'Seed Sneakers Runner', quantity: 1, unitPriceCents: 249900 }],
  },
  {
    buyerEmail: 'buyer2@seed.marketplace.dev',
    status: 'paid',
    createdAt: '2026-01-06T09:15:00.000Z',
    items: [
      { productName: 'Seed Headphones ANC', quantity: 1, unitPriceCents: 449900 },
      { productName: 'Seed Backpack Urban', quantity: 1, unitPriceCents: 189900 },
    ],
  },
  {
    buyerEmail: 'buyer2@seed.marketplace.dev',
    status: 'cancelled',
    createdAt: '2026-01-20T18:45:00.000Z',
    items: [{ productName: 'Seed Sneakers Leather', quantity: 1, unitPriceCents: 329900 }],
  },
  {
    buyerEmail: 'buyer3@seed.marketplace.dev',
    status: 'paid',
    createdAt: '2026-01-07T11:20:00.000Z',
    items: [{ productName: 'Seed Laptop 14', quantity: 1, unitPriceCents: 3499900 }],
  },
  {
    buyerEmail: 'buyer3@seed.marketplace.dev',
    status: 'paid',
    createdAt: '2026-01-15T16:00:00.000Z',
    items: [
      { productName: 'Seed Book Node.js', quantity: 2, unitPriceCents: 59900 },
      { productName: 'Seed T-Shirt Print', quantity: 1, unitPriceCents: 34900 },
    ],
  },
  {
    buyerEmail: 'buyer4@seed.marketplace.dev',
    status: 'pending',
    createdAt: '2026-01-18T08:10:00.000Z',
    items: [
      { productName: 'Seed T-Shirt Basic', quantity: 3, unitPriceCents: 29900 },
      { productName: 'Seed Backpack Urban', quantity: 1, unitPriceCents: 189900 },
      { productName: 'Seed Book Node.js', quantity: 1, unitPriceCents: 59900 },
    ],
  },
  {
    buyerEmail: 'buyer4@seed.marketplace.dev',
    status: 'paid',
    createdAt: '2026-01-25T13:40:00.000Z',
    items: [{ productName: 'Seed Headphones ANC', quantity: 2, unitPriceCents: 449900 }],
  },
];

async function seedUsers(): Promise<Map<string, User>> {
  const repo = AppDataSource.getRepository(User);

  await repo.upsert(
    SEED_USERS.map((u) => ({ email: u.email, passwordHash: u.passwordHash, role: u.role })),
    ['email'],
  );

  const users = await repo.find({ where: SEED_USERS.map((u) => ({ email: u.email })) });
  const byEmail = new Map(users.map((u) => [u.email, u]));
  console.log(`users: ${users.length} у базі (seed-набір: ${SEED_USERS.length})`);
  return byEmail;
}

async function seedProducts(usersByEmail: Map<string, User>): Promise<Map<string, Product>> {
  const repo = AppDataSource.getRepository(Product);
  let created = 0;

  for (const p of SEED_PRODUCTS) {
    const existing = await repo.findOne({ where: { name: p.name } });
    if (existing) continue;

    const seller = usersByEmail.get(p.sellerEmail);
    if (!seller) throw new Error(`seed: продавець ${p.sellerEmail} не знайдений`);

    await repo.insert({
      name: p.name,
      description: p.description,
      seller: { id: seller.id },
      priceCents: p.priceCents,
      stock: p.stock,
      isActive: p.isActive,
    });
    created++;
  }

  const products = await repo.find({ where: SEED_PRODUCTS.map((p) => ({ name: p.name })) });
  const byName = new Map(products.map((p) => [p.name, p]));
  console.log(`products: ${products.length} у базі (${created} нових цим запуском)`);
  return byName;
}

async function seedOrders(usersByEmail: Map<string, User>, productsByName: Map<string, Product>): Promise<void> {
  const orderRepo = AppDataSource.getRepository(Order);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  let createdOrders = 0;
  let createdItems = 0;

  for (const o of SEED_ORDERS) {
    const createdAt = new Date(o.createdAt);
    const existing = await orderRepo.findOne({ where: { createdAt } });
    if (existing) continue;

    const buyer = usersByEmail.get(o.buyerEmail);
    if (!buyer) throw new Error(`seed: покупець ${o.buyerEmail} не знайдений`);

    const totalAmountCents = o.items.reduce((sum, it) => sum + it.unitPriceCents * it.quantity, 0);

    const insertResult = await orderRepo.insert({
      buyer: { id: buyer.id },
      status: o.status,
      totalAmountCents,
      createdAt,
    });
    const orderId = insertResult.identifiers[0].id as string;
    createdOrders++;

    for (const it of o.items) {
      const product = productsByName.get(it.productName);
      if (!product) throw new Error(`seed: товар ${it.productName} не знайдений`);

      await itemRepo.insert({
        order: { id: orderId },
        product: { id: product.id },
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
      });
      createdItems++;
    }
  }

  const [orderCount, itemCount] = await Promise.all([orderRepo.count(), itemRepo.count()]);
  console.log(`orders: ${orderCount} у базі (${createdOrders} нових цим запуском)`);
  console.log(`order_items: ${itemCount} у базі (${createdItems} нових цим запуском)`);
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const usersByEmail = await seedUsers();
    const productsByName = await seedProducts(usersByEmail);
    await seedOrders(usersByEmail, productsByName);
    console.log('Seed завершено.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Seed впав:', err);
  process.exit(1);
});
