// ─── Module Événementiel (052) ──────────────────────────────────────────────
// Types partagés storefront/admin pour événements (soirées BBQ), services
// (Traiteur / Location Matériel) et la galerie photo associée.

export type EventStatus = 'draft' | 'published' | 'closed' | 'cancelled';

// Élément de la feature row hero (058) — `icon` référence une clé du
// registre HIGHLIGHT_ICONS (src/lib/events/highlightIcons.tsx côté storefront)
// et reste `string` (pas une union stricte) ici : le JSON en base peut
// contenir une clé pas encore connue du registre (ajout futur), le fallback
// vers une icône neutre se fait à l'exécution, jamais via le typage.
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
  // Palette scoped à l'événement (056) — le module Événementiel a désormais
  // sa propre identité par défaut (058, EVENT_MODULE_DEFAULT_PRIMARY/SECONDARY
  // dans evenements/[slug]/page.tsx), plus de fallback vers tenant.primary_color.
  // Colonne conservée pour l'override futur par événement.
  theme_primary_color: string | null;
  theme_secondary_color: string | null;
  // Sous-titre optionnel sous le titre hero (058, ex. "La Première").
  subtitle: string | null;
  // Feature row hero optionnelle (058) — 0 à 3 éléments, section absente si null/vide.
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
  // Badge textuel optionnel sur la card formule (058, ex. "LA PLUS POPULAIRE").
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
  /** null pour une réservation confirmée via paiement par lien externe (Phase 2). */
  stripe_payment_intent_id: string | null;
  amount_paid: number;
  qr_token: string;
  quantity_total: number;
  quantity_remaining: number;
  status: EventReservationStatus;
  created_at: string;
}

// ─── Phase 2 — paiement via lien externe (billetterie) ─────────────────────

export type EventReservationRequestStatus = 'pending' | 'confirmed' | 'stock_conflict';

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

// Redemption granulaire par ligne formule (053) — distincte de
// EventReservationRedemption (052, journal au niveau réservation).
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

export type ServiceInquiryStatus = 'nouveau' | 'contacte' | 'clos';

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
  created_at: string;
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
  /** null pour une réservation confirmée via paiement par lien externe (Phase 3). */
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
  created_at: string;
}

// ─── Payloads API ────────────────────────────────────────────────────────────

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
  items: string; // JSON.stringify(EventCheckoutItemInput[])
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

export interface RentalPaymentIntentMetadata {
  type: 'rental_reservation';
  service_offering_id: string;
  tenant_id: string;
  pickup_date: string;
  items: string; // JSON.stringify(RentalCheckoutItemInput[])
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

// ─── Phase 3 — paiement via lien externe (location matériel) ───────────────

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
