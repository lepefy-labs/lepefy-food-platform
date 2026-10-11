/**
 * GET /api/address/postal-lookup?country=IT&city=reggio
 * GET /api/address/postal-lookup?country=IT&postalCode=42121
 *
 * Suggestions ville → codes postaux et code postal → ville pour le formulaire
 * d'adresse client. Lecture seule de l'index GeoNames public
 * `shipping_postal_code_index` (Shipping Intelligence, migration 120) : la
 * réponse ne contient que ville, province et codes postaux, identiques pour
 * tous les tenants (cache CDN). Ne dit jamais si la livraison est possible.
 * Index vide ou indisponible → `cities: []`, le formulaire reste utilisable.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isDeliveryCountry, isValidPostalCode, normalizePostalCode } from '@/lib/address/addressRules';
import { buildPostalLookupCities, cityQueryKey } from '@/lib/address/postalLookup';

const ROW_LIMIT = 1000;
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' };
const COLUMNS = 'place_name, place_name_normalized, admin_name1, admin_code1, admin_name2, admin_code2, postal_code';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const country = (searchParams.get('country') ?? '').trim().toUpperCase();
  const cityParam = searchParams.get('city');
  const postalParam = searchParams.get('postalCode');

  if (!isDeliveryCountry(country) || (!cityParam && !postalParam)) {
    return NextResponse.json({ cities: [] }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();

    if (postalParam) {
      const postalCode = normalizePostalCode(country, postalParam);
      if (!isValidPostalCode(country, postalCode)) return NextResponse.json({ cities: [] }, { headers: CACHE_HEADERS });
      const { data, error } = await supabase
        .from('shipping_postal_code_index')
        .select(COLUMNS)
        .eq('country', country)
        .eq('postal_code', postalCode)
        .limit(50);
      if (error) throw new Error(error.message);
      return NextResponse.json({ cities: buildPostalLookupCities(data ?? [], country) }, { headers: CACHE_HEADERS });
    }

    const query = cityQueryKey(cityParam ?? '');
    if (query.length < 3) return NextResponse.json({ cities: [] }, { headers: CACHE_HEADERS });
    const { data, error } = await supabase
      .from('shipping_postal_code_index')
      .select(COLUMNS)
      .eq('country', country)
      .ilike('place_name_normalized', `${query}%`)
      .order('place_name_normalized', { ascending: true })
      .order('postal_code', { ascending: true })
      .limit(ROW_LIMIT);
    if (error) throw new Error(error.message);

    let rows = data ?? [];
    // Limite atteinte : la dernière commune peut être incomplète, on l'écarte
    // plutôt que de proposer une liste de codes postaux tronquée.
    if (rows.length === ROW_LIMIT) {
      const lastName = rows[rows.length - 1]?.place_name_normalized;
      rows = rows.filter((row) => row.place_name_normalized !== lastName);
    }
    return NextResponse.json({ cities: buildPostalLookupCities(rows, country, query) }, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('[address/postal-lookup] index read failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ cities: [], unavailable: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
