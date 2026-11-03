export interface Product {
  id: string;
  name: string;
  description?: string;
  price_cents: number;
  stock: number;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

// Allowed status changes. A status missing from a list cannot be reached from
// the key; delivered and cancelled are final.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Statuses from which `to` can be reached. */
export function statusesBefore(to: OrderStatus): OrderStatus[] {
  return (Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).filter((from) =>
    ORDER_TRANSITIONS[from].includes(to),
  );
}

export interface Order {
  id: string;
  buyer_id: string;
  status: OrderStatus;
  items: OrderItem[];
  total_cents: number;
  created_at: string;
}
