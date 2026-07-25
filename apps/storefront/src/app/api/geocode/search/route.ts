/**
 * apps/storefront/src/app/api/geocode/search/route.ts
 *
 * GET /api/geocode/search?q=<testo>&country=<ISO2>
 * Proxy server-side verso Nominatim (OpenStreetMap) per l'autocomplete
 * indirizzo del carrello. Non tenant-specific: pura utility geografica.
 */

import { NextResponse } from 'next/server';

interface GeocodeResult {
  label: string;
  postalCode: string;
  city: string;
}

interface NominatimAddress {
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
}

interface NominatimResult {
  display_name: string;
  address?: NominatimAddress;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? '';
  const country = searchParams.get('country') ?? '';

  if (q.length < 3) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=${encodeURIComponent(country)}&q=${encodeURIComponent(q)}&limit=5`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': process.env.NOMINATIM_USER_AGENT ?? 'LepefyFoodPlatform/1.0',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!res.ok) {
      return NextResponse.json({ results: [] });
    }

    const data = (await res.json()) as NominatimResult[];

    const results: GeocodeResult[] = data
      .filter((item) => item.address?.postcode)
      .map((item) => ({
        label: item.display_name,
        postalCode: item.address!.postcode!,
        city: item.address?.city || item.address?.town || item.address?.village || '',
      }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[geocode/search] Nominatim request failed:', err);
    return NextResponse.json({ results: [] });
  }
}
