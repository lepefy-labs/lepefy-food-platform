import { NextRequest, NextResponse } from 'next/server';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { getTenant } from '@/lib/tenant/getTenant';
import { getSessionCustomer } from '@/lib/auth/getSessionCustomer';
import { getCustomerProfile } from '@/lib/customers/getCustomerProfile';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/customers/me
// → 401 se non autenticato (parcours guest : le checkout ne l'appelle jamais)
// → { fullName, phone, email, defaultAddress: Address | null }
export async function GET() {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const profile = await getCustomerProfile(sessionCustomer.id, tenant.id);
  if (!profile) {
    return NextResponse.json({ error: 'Profil introuvable.' }, { status: 404 });
  }

  return NextResponse.json(profile);
}

// PATCH /api/customers/me — édition "Informations personnelles" de la page
// /compte (nom, téléphone). Toujours scopé customer_id + tenant_id, jamais
// via le client anon (RLS écriture non ouverte sur customers pour les
// clients — cf. 040_loyalty_referral_system.sql §11) : passe par
// createServiceClient() comme le reste des endpoints /api/loyalty/*.
export async function PATCH(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const sessionCustomer = await getSessionCustomer(tenant.id);
  if (!sessionCustomer) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  const body = await req.json() as { fullName?: string; phone?: string | null };

  if (typeof body.fullName !== 'string' || body.fullName.trim().length === 0) {
    return NextResponse.json({ error: 'Le nom ne peut pas être vide.' }, { status: 400 });
  }

  // Le client envoie déjà le numéro au format E.164 (cf. toE164() dans
  // ProfileEditModal.tsx via lib/utils/phone.ts) — ici on ne fait que
  // vérifier que c'est bien le cas, sans defaultCountry, et on retient
  // toujours la forme canonique .number pour la persistance en DB (jamais un
  // texte formaté pour l'affichage, pour un réemploi futur : WhatsApp, SMS…).
  let phone: string | null = null;
  if (body.phone != null && body.phone.trim().length > 0) {
    const raw = body.phone.trim();
    const parsed = raw.startsWith('+') ? parsePhoneNumberFromString(raw) : null;
    if (!parsed || !parsed.isValid()) {
      return NextResponse.json({ error: 'Format de téléphone invalide.' }, { status: 400 });
    }
    phone = parsed.number;
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('customers')
    .update({ full_name: body.fullName.trim(), phone })
    .eq('id', sessionCustomer.id)
    .eq('tenant_id', tenant.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const profile = await getCustomerProfile(sessionCustomer.id, tenant.id);
  return NextResponse.json(profile);
}
