/**
 * apps/storefront/src/app/api/geocode/search/route.ts
 *
 * GET /api/geocode/search?q=<texte>&country=<ISO2>
 * Proxy serveur vers Photon (OpenStreetMap) pour la « Recherche rapide » du
 * formulaire d'adresse. Utilitaire géographique, identique pour tous les
 * tenants. Réponse : { results, unavailable } — `unavailable` distingue
 * « service en panne » de « aucun résultat » ; dans les deux cas le client
 * remplit les champs lui-même.
 */

import { NextResponse } from 'next/server';
import { isDeliveryCountry } from '@/lib/address/addressRules';
import { COUNTRY_BBOX, photonToSuggestions, type AddressSuggestion } from '@/lib/address/geocodeSearch';

const PHOTON_URL = process.env.PHOTON_API_URL ?? 'https://photon.komoot.io/api/';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

// Cache mémoire par instance : les mêmes débuts de saisie reviennent souvent
// et chaque appel évité ménage le service public Photon (usage équitable).
const cache = new Map<string, { at: number; results: AddressSuggestion[] }>();

function readCache(key: string): AddressSuggestion[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.results;
}

function writeCache(key: string, results: AddressSuggestion[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), results });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const country = (searchParams.get('country') ?? '').trim().toUpperCase();

  if (q.length < 4 || !isDeliveryCountry(country)) {
    return NextResponse.json({ results: [], unavailable: false });
  }

  const key = `${country}|${q.toLowerCase()}`;
  const cached = readCache(key);
  if (cached) return NextResponse.json({ results: cached, unavailable: false });

  try {
    const url = new URL(PHOTON_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '15');
    // Noms locaux (« Reggio nell'Emilia »), comme sur l'adresse postale — pas de traduction.
    url.searchParams.set('lang', 'default');
    const bbox = COUNTRY_BBOX[country];
    if (bbox) url.searchParams.set('bbox', bbox);
    const res = await fetch(url, {
      headers: { 'User-Agent': process.env.ADDRESS_SEARCH_USER_AGENT ?? 'LepefyFoodPlatform/1.0 (address search)' },
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn('[geocode/search] Photon responded', res.status);
      return NextResponse.json({ results: [], unavailable: true });
    }
    const results = photonToSuggestions(await res.json(), country);
    writeCache(key, results);
    return NextResponse.json({ results, unavailable: false });
  } catch (err) {
    console.error('[geocode/search] Photon request failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ results: [], unavailable: true });
  }
}
