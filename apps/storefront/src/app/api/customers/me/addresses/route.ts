import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { createServiceClient } from '@/lib/supabase/server';

interface AddressBody {
  fullName?:   string;
  line1?:      string;
  line2?:      string | null;
  city?:       string;
  postalCode?: string;
  country?:    string;
  isDefault?:  boolean;
}

function validate(body: AddressBody): string | null {
  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) return 'Le nom du destinataire est obligatoire.';
  if (typeof body.line1 !== 'string' || body.line1.trim().length === 0) return 'La rue est obligatoire.';
  if (typeof body.city !== 'string' || body.city.trim().length === 0) return 'La ville est obligatoire.';
  if (typeof body.postalCode !== 'string' || body.postalCode.trim().length === 0) return 'Le code postal est obligatoire.';
  if (typeof body.country !== 'string' || body.country.trim().length === 0) return 'Le pays est obligatoire.';
  return null;
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
  const validationError = validate(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

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
      full_name:   body.fullName!.trim(),
      line1:       body.line1!.trim(),
      line2:       body.line2?.trim() || null,
      city:        body.city!.trim(),
      postal_code: body.postalCode!.trim(),
      country:     body.country!.trim(),
      is_default:  makeDefault,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
