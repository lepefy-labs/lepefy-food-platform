export type OrderStatus = 'new' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'stripe' | 'satispay' | 'cash';
export type FulfillmentType = 'delivery' | 'pickup';

export interface Order {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string;
  full_name: string | null;
  fulfillment_type: FulfillmentType;
  shipping_address: ShippingAddress | null;
  shipping_details: Record<string, unknown> | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  status: OrderStatus;
  tracking_code: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShippingAddress {
  full_name: string;
  line1: string;
  line2?: string;
  city: string;
  postal_code: string;
  country: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  tenant_id: string;
  product_id: string | null;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}
