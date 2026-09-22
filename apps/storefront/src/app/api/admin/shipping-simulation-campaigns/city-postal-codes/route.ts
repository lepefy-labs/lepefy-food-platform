import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  resolveShippingCityPostalCodes,
  searchShippingCities,
  searchCitiesFromIndex,
  resolvePostalCodesFromIndex,
  type AdministrativeContext,
  type PostalResolution,
} from '@/lib/shipping/intelligence/postalCityLookup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ALLOWED_COUNTRIES = new Set(['IT', 'FR', 'BE', 'DE', 'CH']);

function adminParam(value: string | null): string | null {
  const code = (value ?? '').trim().toUpperCase();
  return code && /^[A-Z0-9-]{1,20}$/.test(code) ? code : null;
}

function resolutionResponse(country: string, city: string, resolution: PostalResolution, source: 'index' | 'network') {
  if (resolution.status === 'resolved') {
    const { group, matchedBy } = resolution;
    return NextResponse.json({
      status: 'resolved',
      country,
      city: group.placeName || city,
      adminCode1: group.adminCode1,
      adminCode2: group.adminCode2,
      adminName: [group.adminName2, group.adminName1].filter(Boolean).join(' · '),
      postalCodes: group.postalCodes,
      matchedBy,
      source,
      // Le jeu de données ne permet pas de prouver l'exhaustivité des CAP.
      completeness: 'unverified',
    });
  }
  if (resolution.status === 'ambiguous') {
    return NextResponse.json({
      status: 'ambiguous',
      country,
      city,
      source,
      options: resolution.options.map((o) => ({
        city: o.placeName,
        adminCode1: o.adminCode1,
        adminCode2: o.adminCode2,
        adminName1: o.adminName1,
        adminName2: o.adminName2,
        postalCodeCount: o.postalCodes.length,
        label: o.label,
      })),
    });
  }
  return null;
}

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
      if (city.length < 2 || city.length > 80) return NextResponse.json({ error: 'Ville invalide.' }, { status: 400 });

      // exact=1 : codes GeoNames d'un candidat de l'index (ou d'une option de
      // désambiguïsation) — un code vide signifie « absent » dans GeoNames.
      const context: AdministrativeContext = searchParams.get('exact') === '1'
        ? { exact: { adminCode1: adminParam(searchParams.get('adminCode1')), adminCode2: adminParam(searchParams.get('adminCode2')) } }
        : { stateCodes: (searchParams.get('stateCodes') ?? '').split(',').map((code) => code.trim()).filter(Boolean) };

      const indexed = await resolvePostalCodesFromIndex(supabase, country, city, context);
      const indexedResponse = resolutionResponse(country, city, indexed, 'index');
      if (indexedResponse) return indexedResponse;

      if (!context.exact) {
        const network = await resolveShippingCityPostalCodes(country, city, context);
        const networkResponse = resolutionResponse(country, city, network, 'network');
        if (networkResponse) return networkResponse;
      }

      return NextResponse.json(
        { error: 'Aucun code postal trouvé pour cette commune. Saisissez le code postal manuellement.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ error: 'Mode invalide.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Service géographique temporairement indisponible.' }, { status: 503 });
  }
}
