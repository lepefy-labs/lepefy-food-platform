export type AmbassadorDiscountType = 'PERCENT' | 'FIXED';
export type AmbassadorPaymentMethod = 'IBAN' | 'PAYPAL';
export type AmbassadorCommissionStatus = 'CONFIRMED' | 'PAID' | 'CANCELLED';

export interface AmbassadorCommission {
  id: string;
  tenant_id: string;
  ambassador_customer_id: string;
  referred_customer_id: string;
  order_id: string;
  order_subtotal: number;
  order_amount_paid: number;
  discount_applied: number;
  rate_applied: number;
  max_commission_applied: number;
  commission_amount: number;
  status: AmbassadorCommissionStatus;
  paid_at: string | null;
  paid_by_admin_id: string | null;
  payment_note: string | null;
  created_at: string;
}
