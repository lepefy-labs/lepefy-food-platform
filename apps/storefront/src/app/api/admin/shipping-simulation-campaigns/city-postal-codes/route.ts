import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  resolveShippingCityPostalCodes,
  searchShippingCities,
  searchCitiesFromIndex,
  resolvePostalCodesFromIndex,
} from '@/lib/shipping/intelligence/postalCityLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ALLOWED_COUNTRIES = new Set(['IT', 'FR', 'BE', 'DE', 'CH']);

export async function GET(request: Request) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'search';
  const country = (searchParams.get('country') ?? '').trim().toUpperCase();

  if (!ALLOWED_COUNTRIES.has(country)) {
    return NextResponse.json({ error: 'Pays non pris en charge.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    if (mode === 'search') {
      const q = (searchParams.get('q') ?? '').trim();
      if (q.length < 2 || q.length > 80) return NextResponse.json({ candidates: [] });

      // Index interne (import GeoNames statique) en premier — aucun appel
      // réseau si peuplé pour ce pays. Repli Nominatim uniquement si l'index
      // ne renvoie rien (pas encore importé pour ce pays, ou ville absente).
      const indexed = await searchCitiesFromIndex(supabase, country, q);
      if (indexed.length > 0) return NextResponse.json({ candidates: indexed, source: 'index' });

      const candidates = await searchShippingCities(country, q);
      return NextResponse.json({ candidates, source: 'nominatim' });
    }

    if (mode === 'resolve') {
      const city = (searchParams.get('city') ?? '').trim();
      const stateCodes = (searchParams.get('stateCodes') ?? '').split(',').map((code) => code.trim()).filter(Boolean);

      const indexedPostalCodes = await resolvePostalCodesFromIndex(supabase, country, city);
      if (indexedPostalCodes.length > 0) {
        return NextResponse.json({
          country, city, stateCode: stateCodes[0] ?? '', postalCodes: indexedPostalCodes, source: 'index',
        });
      }

      const result = await resolveShippingCityPostalCodes(country, city, stateCodes);
      if (!result) {
        return NextResponse.json(
          { error: 'Aucun ensemble complet de codes postaux trouvé pour cette ville.' },
          { status: 404 },
        );
      }
      return NextResponse.json({ ...result, source: 'network' });
    }

    return NextResponse.json({ error: 'Mode invalide.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Service géographique temporairement indisponible.' }, { status: 503 });
  }
}
