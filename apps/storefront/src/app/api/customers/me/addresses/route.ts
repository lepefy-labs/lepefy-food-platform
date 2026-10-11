import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeShippingAddress } from '@/lib/address/addressRules';

interface AddressBody {
  fullName?:   string;
  line1?:      string;
  line2?:      string | null;
  city?:       string;
  postalCode?: string;
  country?:    string;
  isDefault?:  boolean;
}

// GET /api/customers/me/addresses — adresses du client connecté (sélection
// au checkout). Défaut d'abord, puis la plus récente. Scopé tenant + client.
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const { data, error } = await createServiceClient()
    .from('addresses')
    .select('id, full_name, line1, line2, city, postal_code, country, is_default')
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[customers/me/addresses][GET] read failed:', error.message);
    return NextResponse.json({ error: 'Vos adresses ne sont pas disponibles pour le moment.' }, { status: 500 });
  }
  return NextResponse.json({ addresses: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

// POST /api/customers/me/addresses — ajout d'une adresse depuis /compte.
// Toujours via createServiceClient() + scoping customer_id/tenant_id manuel
// (même raison que PATCH /api/customers/me : écriture client non ouverte
// par RLS sur addresses, cf. 002_rls_policies.sql).
export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const body = await req.json() as AddressBody;
  // Même contrôle que le checkout : champs connus seulement, texte nettoyé,
  // longueurs et format du code postal.
  const normalized = normalizeShippingAddress({
    full_name: body.fullName, line1: body.line1, line2: body.line2,
    city: body.city, postal_code: body.postalCode, country: body.country,
  });
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, code: 'ADDRESS_INVALID', field: normalized.field }, { status: 400 });
  }
  const address = normalized.address;

  const supabase = createServiceClient();

  const { count } = await supabase
    .from('addresses')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', sessionCustomer.id)
    .eq('tenant_id', tenant.id);

  // La toute première adresse d'un client devient toujours par défaut —
  // sinon on se retrouverait avec des adresses mais aucune "par défaut",
  // état que getCustomerProfile() (préremplissage checkout) ne gère pas.
  const makeDefault = (count ?? 0) === 0 || body.isDefault === true;

  if (makeDefault) {
    const { error: unsetError } = await supabase
      .from('addresses')
      .update({ is_default: false })
      .eq('customer_id', sessionCustomer.id)
      .eq('tenant_id', tenant.id)
      .eq('is_default', true);

    if (unsetError) {
      return NextResponse.json({ error: unsetError.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from('addresses')
    .insert({
      customer_id: sessionCustomer.id,
      tenant_id:   tenant.id,
      full_name:   address.full_name,
      line1:       address.line1,
      line2:       address.line2 ?? null,
      city:        address.city,
      postal_code: address.postal_code,
      country:     address.country,
      is_default:  makeDefault,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
