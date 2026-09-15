export type CustomerSource = 'signup' | 'guest_checkout' | 'admin' | 'in_store' | 'event' | 'import' | 'other';
export type RfmSegment = 'champion' | 'loyal' | 'potential_loyalist' | 'new' | 'at_risk' | 'hibernating' | 'lost';
export type SegmentKind = 'system' | 'custom';
export type SegmentBooleanOperator = 'and' | 'or';
export type SegmentOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'not_contains' | 'before' | 'after' | 'in' | 'not_in';
export type SegmentField =
  | 'orders_count' | 'lifetime_value' | 'average_order_value' | 'days_since_last_order'
  | 'created_at' | 'source' | 'marketing_consent' | 'loyalty_points' | 'rfm_segment'
  | 'tag' | 'favorite_category' | 'favorite_product' | 'event_participation';

export interface SegmentCondition {
  field: SegmentField;
  operator: SegmentOperator;
  value: string | number | boolean | string[];
}

export interface SegmentDefinition {
  operator: SegmentBooleanOperator;
  conditions: SegmentCondition[];
}

export interface CrmCustomerListItem {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  source: CustomerSource;
  loyalty_card_number: string | null;
  created_at: string;
  orders_count: number;
  completed_orders_count: number;
  lifetime_value: number;
  average_order_value: number;
  last_order_at: string | null;
  days_since_last_order: number | null;
  online_spend: number;
  in_store_spend: number;
  loyalty_points_balance: number;
  last_activity_at: string;
  event_reservations_count: number;
  products_count: number;
  favorite_product_id: string | null;
  favorite_category_id: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_consent_source: string | null;
  rfm_segment: RfmSegment;
  recency_score: number;
  frequency_score: number;
  monetary_score: number;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'processing' | 'completed' | 'cancelled' | 'failed';
export type CampaignChannel = 'email' | 'sms' | 'whatsapp' | 'push';
export type CampaignRecipientStatus = 'pending' | 'processing' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'converted' | 'skipped' | 'failed';
