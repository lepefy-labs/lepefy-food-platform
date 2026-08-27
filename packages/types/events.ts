// ─── Module Événementiel (052) ──────────────────────────────────────────────
// Types partagés storefront/admin pour événements (soirées BBQ), services
// (Traiteur / Location Matériel) et la galerie photo associée.

export type EventStatus = 'draft' | 'published' | 'closed' | 'cancelled';

export interface EventHighlight {
  icon: string;
  title: string;
  text: string;
}

export interface EventRow {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description: string | null;
  date_start: string;
  location: string | null;
  capacity_total: number;
  capacity_remaining: number;
  status: EventStatus;
  banner_image_url: string | null;
  theme_primary_color: string | null;
  theme_secondary_color: string | null;
  subtitle: string | null;
  highlights: EventHighlight[] | null;
  created_at: string;
  updated_at: string;
}

export interface EventTicketType {
  id: string;
  tenant_id: string;
  event_id: string;
  label: string;
  description: string | null;
  price: number;
  sort_order: number;
  active: boolean;
  badge: string | null;
}

export type EventReservationStatus = 'confirmed' | 'cancelled' | 'refunded';

export interface EventReservation {
  id: string;
  tenant_id: string;
  event_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  stripe_payment_intent_id: string | null;
  amount_paid: number;
  qr_token: string;
  quantity_total: number;
  quantity_remaining: number;
  status: EventReservationStatus;
  created_at: string;
}

export type EventReservationRequestStatus = 'pending' | 'confirmed' | 'stock_conflict' | 'cancelled';

export interface EventReservationRequest {
  id: string;
  tenant_id: string;
  event_id: string;
  items: EventCheckoutItemInput[];
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  amount: number;
  currency: string;
  payment_method_type: string;
  payment_method_label: string;
  payment_link: string;
  status: EventReservationRequestStatus;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  reservation_id: string | null;
}

export interface EventReservationItem {
  id: string;
  reservation_id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price: number;
}

export interface EventReservationRedemption {
  id: string;
  reservation_id: string;
  redeemed_by: string | null;
  quantity_redeemed: number;
  redeemed_at: string;
}

export interface EventReservationItemRedemption {
  id: string;
  reservation_item_id: string;
  quantity_redeemed: number;
  redeemed_by: string | null;
  redeemed_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export type ServiceOfferingType = 'traiteur' | 'location_materiel' | 'autre';
export type ServiceCtaType = 'devis' | 'reservation';

export interface ServiceOffering {
  id: string;
  tenant_id: string;
  slug: string;
  type: ServiceOfferingType;
  title: string;
  description: string | null;
  cta_type: ServiceCtaType;
  cover_image_url: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ServiceInquiryStatus =
  | 'nouveau'
  | 'a_contacter'
  | 'contacte'
  | 'devis_envoye'
  | 'accepte'
  | 'refuse'
  | 'clos';

export interface ServiceInquiry {
  id: string;
  tenant_id: string;
  service_offering_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  date_souhaitee: string | null;
  nombre_invites: number | null;
  message: string | null;
  status: ServiceInquiryStatus;
  internal_notes: string | null;
  contacted_at: string | null;
  quote_sent_at: string | null;
  accepted_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RentalItem {
  id: string;
  tenant_id: string;
  service_offering_id: string;
  name: string;
  category: string | null;
  price_per_unit: number;
  stock_quantity: number;
  image_url: string | null;
  active: boolean;
  sort_order: number;
}

export type RentalReservationStatus = 'confirmed' | 'cancelled' | 'refunded';

export interface RentalReservation {
  id: string;
  tenant_id: string;
  service_offering_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  pickup_date: string;
  stripe_payment_intent_id: string | null;
  amount_paid: number;
  status: RentalReservationStatus;
  created_at: string;
}

export interface RentalReservationItem {
  id: string;
  reservation_id: string;
  rental_item_id: string;
  quantity: number;
  unit_price: number;
}

export interface EventGalleryPhoto {
  id: string;
  tenant_id: string;
  event_id: string | null;
  image_url: string;
  caption: string | null;
  sort_order: number;
  is_social_share: boolean;
  created_at: string;
}

export interface EventCheckoutItemInput {
  ticket_type_id: string;
  quantity: number;
}

export interface RentalCheckoutItemInput {
  rental_item_id: string;
  quantity: number;
}

export interface EventPaymentIntentMetadata {
  type: 'event_reservation';
  event_id: string;
  tenant_id: string;
  items: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

export interface RentalPaymentIntentMetadata {
  type: 'rental_reservation';
  service_offering_id: string;
  tenant_id: string;
  pickup_date: string;
  items: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

export type RentalReservationRequestStatus = 'pending' | 'confirmed' | 'stock_conflict';

export interface RentalReservationRequest {
  id: string;
  tenant_id: string;
  service_offering_id: string;
  items: RentalCheckoutItemInput[];
  pickup_date: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  amount: number;
  currency: string;
  payment_method_type: string;
  payment_method_label: string;
  payment_link: string;
  status: RentalReservationRequestStatus;
  created_at: string;
  confirmed_at: string | null;
  reservation_id: string | null;
}
