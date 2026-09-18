let products = [
  { id: 'prod_1', name: 'Mechanical Keyboard', description: 'Hot-swappable 75% keyboard', price_cents: 8999, stock: 12 },
  { id: 'prod_2', name: 'Wireless Mouse', description: 'Ergonomic wireless mouse', price_cents: 2500, stock: 40 },
  { id: 'prod_3', name: 'USB-C Dock', description: '10-port docking station', price_cents: 14999, stock: 5 },
];

let orders = [];
let nextOrderNumber = 1;

const idempotencyStore = new Map();

function findProduct(id) {
  return products.find((p) => p.id === id);
}

function findOrder(id) {
  return orders.find((o) => o.id === id);
}

function createOrder(items) {
  const orderItems = items.map(({ product_id, quantity }) => {
    const product = findProduct(product_id);
    return product
      ? { product_id, quantity, unit_price_cents: product.price_cents }
      : null;
  });

  if (orderItems.some((item) => item === null)) {
    return { error: 'product_not_found' };
  }

  const total_cents = orderItems.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity,
    0,
  );

  const order = {
    id: `order_${nextOrderNumber++}`,
    status: 'pending',
    items: orderItems,
    total_cents,
    created_at: new Date().toISOString(),
  };

  orders.push(order);
  return { order };
}

module.exports = {
  products,
  orders,
  findProduct,
  findOrder,
  createOrder,
  idempotencyStore,
};
