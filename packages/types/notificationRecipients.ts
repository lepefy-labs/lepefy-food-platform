export interface TenantNotificationRecipient {
  id: string;
  tenant_id: string;
  email: string;
  label: string | null;
  notify_card_payment: boolean;
  notify_external_payment_pending: boolean;
  notify_order_stock_conflict: boolean;
  notify_event_booking_closed_reports?: boolean;
  active: boolean;
  created_at: string;
}
