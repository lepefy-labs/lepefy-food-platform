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
  line1: string;
  city: string;
  postalCode: string;
  country: string;
}

interface NominatimAddress {
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  road?: string;
  house_number?: string;
  country_code?: string;
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
      .filter((item) => item.address?.postcode && item.address?.road)
      .map((item) => {
        const address = item.address!;
        return {
          label: item.display_name,
          line1: address.house_number ? `${address.road} ${address.house_number}` : address.road!,
          city: address.city || address.town || address.village || '',
          postalCode: address.postcode!,
          country: (address.country_code ?? '').toUpperCase(),
        };
      });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[geocode/search] Nominatim request failed:', err);
    return NextResponse.json({ results: [] });
  }
}
