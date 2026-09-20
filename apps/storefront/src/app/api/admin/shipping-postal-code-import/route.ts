/**
 * POST /api/admin/shipping-postal-code-import
 * Body: { country: string }
 *
 * Déclencheur admin de importCountryPostalCodes() — un seul pays par appel
 * pour rester dans le budget maxDuration (l'écran fait une requête par pays
 * sélectionné et affiche la progression au fur et à mesure). Réservé à
 * shipping.manage : c'est une action de maintenance, pas de consultation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { importCountryPostalCodes, IMPORTABLE_COUNTRIES } from '@/lib/shipping/intelligence/postalCodeImport';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  let body: { country?: unknown } = {};
  try { body = await req.json(); } catch { /* validé ci-dessous */ }

  const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  if (!(IMPORTABLE_COUNTRIES as readonly string[]).includes(country)) {
    return NextResponse.json(
      { error: 'Pays non pris en charge.', supported: IMPORTABLE_COUNTRIES },
      { status: 400 },
    );
  }

  try {
    const result = await importCountryPostalCodes(createServiceClient(), country);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[admin/shipping-postal-code-import] failed for', country, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Échec de l\'import pour ce pays.' }, { status: 500 });
  }
}
