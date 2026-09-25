import type {
  AssistedCartLine, AssistedOrderEvent, AssistedShippingAddress, CheckoutSessionStatus, SalesChannel,
} from '@lepefy/types';
import type { PreorderAction, PreorderTotals } from '@/lib/orders/assisted/assistedOrderPolicy';

export interface ProductOption {
  id: string;
  name: string;
  price: number;
  compare_at_price: number | null;
  image_url: string | null;
  stock: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  weight_grams: number | null;
  min_order_quantity: number;
  order_quantity_step: number;
}

export interface CustomerOption {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface SavedAddress extends AssistedShippingAddress {
  id: string;
  is_default: boolean;
}

export interface QuantityGroupOption {
  id: string;
  name: string;
  min_quantity: number;
  quantity_step: number;
  productIds: string[];
}

/** Valeurs initiales du formulaire en mode modification. */
export interface AssistedFormInitial {
  preorderId: string;
  reference: string;
  status: CheckoutSessionStatus;
  hadActiveLink: boolean;
  salesChannel: SalesChannel | null;
  customer: { id: string | null; fullName: string; email: string; phone: string };
  items: AssistedCartLine[];
  fulfillmentType: 'delivery' | 'pickup';
  shippingAddress: AssistedShippingAddress | null;
  adminNote: string;
}

export interface PreorderDetail {
  id: string;
  reference: string;
  status: CheckoutSessionStatus;
  salesChannel: SalesChannel | null;
  customerId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  fulfillmentType: 'delivery' | 'pickup';
  shippingAddress: AssistedShippingAddress | null;
  shippingPending: boolean;
  items: AssistedCartLine[];
  totals: PreorderTotals;
  adminNote: string | null;
  notifyCustomer: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  createdBy: string | null;
  payLinkVersion: number;
  payLinkIssuedAt: string | null;
  payUrl: string | null;
  declaredPayment: { method: string | null; label: string | null; declaredAt: string | null; reference: string | null } | null;
  order: { id: string; number: string; status: string; paymentStatus: string; trackingLink: string | null } | null;
}

export interface PreorderDetailResponse {
  preorder: PreorderDetail;
  actions: PreorderAction[];
  events: AssistedOrderEvent[];
  tenantName: string;
  currency: string;
}

export interface PreorderListItem {
  id: string;
  reference: string;
  status: CheckoutSessionStatus;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  salesChannel: SalesChannel | null;
  fulfillmentType: 'delivery' | 'pickup';
  itemCount: number;
  total: number;
  createdAt: string;
  expiresAt: string;
  orderId: string | null;
  hasActiveLink: boolean;
  declaredPayment: string | null;
}
