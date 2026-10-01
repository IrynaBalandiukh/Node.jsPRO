// Уявний фронтенд (консюмер): тонкий клієнт до Marketplace API. Контракт
// описує рівно те, що цей код читає з відповідей.
export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export class MarketplaceClient {
  constructor(private readonly baseUrl: string) {}

  private async call(method: string, path: string, init: { headers?: Record<string, string>; body?: unknown } = {}): Promise<ApiResponse> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Accept: 'application/json, application/problem+json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: res.status, body: await res.json() };
  }

  getProduct(id: string) {
    return this.call('GET', `/products/${id}`);
  }

  getOrder(id: string) {
    return this.call('GET', `/orders/${id}`);
  }

  createOrder(idempotencyKey: string, items: Array<{ product_id: string; quantity: number }>) {
    return this.call('POST', '/orders', {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: { items },
    });
  }
}
