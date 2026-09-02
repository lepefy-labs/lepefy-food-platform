import { CONFIG } from './config';
import { normalizeText } from './deduplication';
import { cacheKey, providerJson } from './providers';
import { getCache, putCache } from './repository';
import { publicLink, socialLink } from './websiteParser';
import type { Prospect } from './types';
export type OsmElement = { id:number; type:string; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags?:Record<string,string> };
export function matchOsm(prospect:Prospect,elements:OsmElement[]):OsmElement | null {
  const exact = elements.filter(e => prospect.siret && e.tags?.['ref:FR:SIRET'] === prospect.siret);
  if (exact.length === 1) return exact[0] ?? null;
  const matches = elements.filter(e => {
    const t = e.tags ?? {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined || prospect.latitude == null || prospect.longitude == null) return false;
    if (t['ref:FR:SIRET'] && prospect.siret && t['ref:FR:SIRET'] !== prospect.siret) return false;
    const distance = Math.hypot((lat-prospect.latitude)*111000,(lon-prospect.longitude)*111000*Math.cos(lat*Math.PI/180));
    return distance <= 100 && normalizeText(t.name ?? '') === normalizeText(prospect.business_name)
      && (!t['addr:postcode'] || t['addr:postcode'] === prospect.postal_code);
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
export async function enrichOsm(prospect:Prospect):Promise<Partial<Prospect>> {
  if (prospect.latitude == null || prospect.longitude == null || (prospect.website_url && prospect.phone)) return {};
  if (prospect.osm_checked_at && Date.parse(prospect.osm_checked_at) > Date.now()-CONFIG.osmDays*86400000) return {};
  const key = cacheKey('osm',{id:prospect.id,lat:prospect.latitude,lon:prospect.longitude});
  const cached = await getCache<Partial<Prospect>>(key); if (cached) return cached;
  const around = '(around:150,'+prospect.latitude+','+prospect.longitude+')';
  const query = '[out:json][timeout:5];(nwr'+around+'["shop"];nwr'+around+'["amenity"~"restaurant|fast_food"];nwr'+around+'["craft"="caterer"];);out center tags 50;';
  const url = new URL('https://overpass-api.de/api/interpreter'); url.searchParams.set('data',query);
  const data = await providerJson<{elements:OsmElement[];remark?:string}>(url.href,'overpass',10);
  if (!Array.isArray(data.elements) || data.remark) throw new Error('Réponse OSM incomplète.');
  const match = matchOsm(prospect,data.elements), t = match?.tags ?? {};
  const patch:Partial<Prospect> = { osm_checked_at:new Date().toISOString(), osm_metadata:match ? {
    source:'OpenStreetMap contributors / ODbL', id:match.type+'/'+match.id, category:t.shop ?? t.amenity ?? t.craft ?? null,
    opening_hours:t.opening_hours?.slice(0,300) ?? null,
  } : { result:'no_unambiguous_match' } };
  const website = publicLink(t.website ?? t['contact:website'] ?? '');
  if (!prospect.website_url && website) { patch.website_url = website; patch.has_website = true; }
  const phone = (t.phone ?? t['contact:phone'] ?? '').replace(/[^\d+]/g,'');
  if (!prospect.phone && /^\+?\d{9,15}$/.test(phone)) patch.phone = phone;
  for (const platform of ['instagram','facebook','tiktok','whatsapp']) {
    const value = t['contact:'+platform] ?? t[platform]; if (!value) continue;
    const link = publicLink(value); const field = link && socialLink(link);
    if (link && field && !prospect[field]) patch[field] = link;
  }
  await putCache(key,patch,CONFIG.osmDays*86400); return patch;
}
