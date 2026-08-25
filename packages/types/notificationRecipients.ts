export interface TenantNotificationRecipient {
  id: string;
  tenant_id: string;
  email: string;
  label: string | null;
  notify_card_payment: boolean;
  notify_external_payment_pending: boolean;
  notify_order_stock_conflict: boolean;
  active: boolean;
  created_at: string;
}
