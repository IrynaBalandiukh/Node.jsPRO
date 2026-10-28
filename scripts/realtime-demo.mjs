// Headless demo of WebSocket room isolation. It measures, it does not assume.
//   node scripts/realtime-demo.mjs              two clients in DIFFERENT rooms: expects A=1, B=0
//   node scripts/realtime-demo.mjs --same-room  control run, both in A's room:  expects A=1, B=1
// Needs the app running and seeded (npm run seed). Server URL: BASE_URL (default http://localhost:3000).
// Exit code: 0 = expectation met, 1 = room isolation broken, 2 = demo could not run.
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SAME_ROOM = process.argv.includes('--same-room');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function pickProduct() {
  const page = await api('GET', '/products?limit=100');
  const product = page.items.find((p) => p.stock >= 2);
  if (!product) throw new Error('no product with stock >= 2 (run npm run seed)');
  return product;
}

const createOrder = (productId) =>
  api('POST', '/orders', { items: [{ product_id: productId, quantity: 1 }] }, { 'Idempotency-Key': randomUUID() });

async function connect(userId) {
  const socket = io(BASE_URL, { transports: ['websocket'], auth: { userId }, reconnection: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    socket.once('connect', () => (clearTimeout(timer), resolve()));
    socket.once('connect_error', (err) => (clearTimeout(timer), reject(err)));
  });
  return socket;
}

async function join(socket, orderId) {
  const result = await socket.timeout(5000).emitWithAck('join', { orderId });
  if (!result.ok) throw new Error(`join order ${orderId} refused: ${result.error}`);
}

async function main() {
  const sockets = [];
  let orderB;
  try {
    const product = await pickProduct();
    const orderA = await createOrder(product.id);
    orderB = await createOrder(product.id);

    const received = { A: 0, B: 0 };
    const clientA = await connect(orderA.buyer_id);
    const clientB = await connect(SAME_ROOM ? orderA.buyer_id : orderB.buyer_id);
    sockets.push(clientA, clientB);
    clientA.on('order.status', () => received.A++);
    clientB.on('order.status', () => received.B++);

    await join(clientA, orderA.id);
    await join(clientB, SAME_ROOM ? orderA.id : orderB.id);

    // The status change goes through plain HTTP, like any other client would do it.
    // "cancelled" returns the stock, so the demo can be repeated.
    await api('PATCH', `/orders/${orderA.id}/status`, { status: 'cancelled' });

    const deadline = Date.now() + 3000;
    while (received.A === 0 && Date.now() < deadline) await sleep(20);
    await sleep(700); // time for an event that must NOT arrive (or, in the control run, must)

    console.log(`MODE=${SAME_ROOM ? 'same-room' : 'different-rooms'}`);
    console.log(`A_RECEIVED=${received.A}`);
    console.log(`B_RECEIVED=${received.B}`);

    const expectedB = SAME_ROOM ? 1 : 0;
    return received.A === 1 && received.B === expectedB ? 0 : 1;
  } finally {
    sockets.forEach((s) => s.close());
    if (orderB) await api('PATCH', `/orders/${orderB.id}/status`, { status: 'cancelled' }).catch(() => {});
  }
}

main()
  .then((code) => {
    console.log(code === 0 ? 'RESULT=OK' : 'RESULT=FAIL');
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`ERROR=${err.message}`);
    process.exitCode = 2;
  });
