export type OrderStatus =
  | 'new'
  | 'preparing'
  | 'ready_for_pickup'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'stock_conflict';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'stripe' | 'satispay' | 'cash' | 'in_store' | 'external_link';
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
  ambassador_discount_amount: number;
  payment_method: PaymentMethod | null;
  payment_status: PaymentStatus;
  stripe_payment_intent_id: string | null;
  /** Snapshot du type de moyen de paiement externe (ex. "paypal") — null si payment_method != external_link. */
  external_payment_type: string | null;
  /** Snapshot du label du moyen de paiement externe au moment de la confirmation. */
  external_payment_label: string | null;
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
  /** Secondary name / transliteration shown on picking lists */
  name_alt: string | null;
  price: number;
  quantity: number;
  subtotal: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  /** Shelf / aisle code used to sort picking lists (e.g. "A-03", "FRIGO-2") */
  warehouse_location: string | null;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}
