// Forme condivise tra GET /api/customers/me (server) e il form di checkout
// (client). File volutamente senza import: può essere importato da un Client
// Component senza trascinare dentro il client Supabase server-side.

export interface CustomerDefaultAddress {
  fullName:   string;
  line1:      string;
  line2:      string | null;
  city:       string;
  postalCode: string;
  country:    string;
}

export interface CustomerProfile {
  fullName:       string | null;
  phone:          string | null;
  email:          string;
  defaultAddress: CustomerDefaultAddress | null;
}
