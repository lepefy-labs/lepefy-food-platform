/**
 * POST /api/internal/shipping-postal-code-import
 * Body: { country: string } — un seul pays par appel, pour rester dans le
 * budget maxDuration même sur un export volumineux (FR/DE ~40k lignes).
 *
 * Import statique (une fois, ou occasionnellement pour rafraîchir) d'un
 * export ZIP GeoNames dans shipping_postal_code_index — jamais appelé au
 * moment d'une requête admin, contrairement aux API externes qu'il remplace.
 * Même modèle d'authentification que /api/internal/shipping-sync : Bearer
 * SUPABASE_SERVICE_ROLE_KEY, comparaison à temps constant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { shippingSyncAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { importCountryPostalCodes, IMPORTABLE_COUNTRIES } from '@/lib/shipping/intelligence/postalCodeImport';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!shippingSyncAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { country?: unknown } = {};
  try { body = await req.json(); } catch { /* corps vide refusé ci-dessous */ }

  const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  if (!(IMPORTABLE_COUNTRIES as readonly string[]).includes(country)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_country', supported: IMPORTABLE_COUNTRIES },
      { status: 400 },
    );
  }

  try {
    const result = await importCountryPostalCodes(createServiceClient(), country);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[shipping-postal-code-import] failed for', country, err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'import_failed' }, { status: 500 });
  }
}
