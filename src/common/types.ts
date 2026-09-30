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

export interface Order {
  id: string;
  status: 'pending' | 'paid' | 'cancelled';
  items: OrderItem[];
  total_cents: number;
  created_at: string;
}
