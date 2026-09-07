import { CONFIG } from './config';
import { matchBusiness, type BusinessCandidate } from './matching';
import { collectionEvidence } from './assessment';
import { cacheKey, providerJson } from './providers';
import { getCache, putCache } from './repository';
import { publicLink, socialLink } from './websiteParser';
import type { Prospect } from './types';
export type OsmElement = { id:number; type:string; lat?:number; lon?:number; center?:{lat:number;lon:number}; tags?:Record<string,string> };
export function osmCandidate(e:OsmElement):BusinessCandidate {
  const t=e.tags ?? {}, category=t.shop ?? t.amenity ?? t.craft;
  return {id:e.type+'/'+e.id,names:[t.name ?? '',t.brand ?? '',t['official_name'] ?? '',t['alt_name'] ?? ''],
    siret:t['ref:FR:SIRET'],postalCode:t['addr:postcode'],city:t['addr:city'],
    address:[t['addr:housenumber'],t['addr:street']].filter(Boolean).join(' ') || undefined,
    latitude:e.lat ?? e.center?.lat,longitude:e.lon ?? e.center?.lon,
    food:category ? /^(supermarket|convenience|greengrocer|butcher|seafood|bakery|deli|cheese|chocolate|confectionery|farm|food|frozen_food|pastry|caterer|restaurant|fast_food|cafe|ice_cream|marketplace)$/.test(category) : undefined};
}
export function matchOsmConfidence(prospect:Prospect,elements:OsmElement[]) {
  const unique=[...new Map(elements.map(e=>[e.type+'/'+e.id,e])).values()];
  return matchBusiness(prospect,unique,osmCandidate);
}
// Compatibility for existing consumers.
export function matchOsm(prospect:Prospect,elements:OsmElement[]):OsmElement | null {
  const result=matchOsmConfidence(prospect,elements); return result.matched ? result.candidate : null;
}
export async function enrichOsm(prospect:Prospect):Promise<Partial<Prospect>> {
  if (prospect.latitude == null || prospect.longitude == null || (prospect.website_url && prospect.phone)) return {};
  if (prospect.osm_checked_at && Date.parse(prospect.osm_checked_at) > Date.now()-CONFIG.osmDays*86400000) return {};
  const key = cacheKey('osm:v2',{id:prospect.id,lat:prospect.latitude,lon:prospect.longitude});
  const cached = await getCache<Partial<Prospect>>(key); if (cached) return cached;
  const around = '(around:150,'+prospect.latitude+','+prospect.longitude+')';
  const query = '[out:json][timeout:5];(nwr'+around+'["shop"];nwr'+around+'["amenity"~"restaurant|fast_food"];nwr'+around+'["craft"="caterer"];);out center tags 50;';
  const url = new URL('https://overpass-api.de/api/interpreter'); url.searchParams.set('data',query);
  const data = await providerJson<{elements:OsmElement[];remark?:string}>(url.href,'overpass',10);
  if (!Array.isArray(data.elements) || data.remark) throw new Error('Réponse OSM incomplète.');
  const result = matchOsmConfidence(prospect,data.elements);
  const match = result.matched ? result.candidate : null, t = match?.tags ?? {};
  const patch:Partial<Prospect> = { osm_checked_at:new Date().toISOString(), osm_metadata:match ? {
    source:'OpenStreetMap contributors / ODbL', id:match.type+'/'+match.id, category:t.shop ?? t.amenity ?? t.craft ?? null,
    opening_hours:t.opening_hours?.slice(0,300) ?? null,
  } : { result:result.ambiguous ? 'ambiguous' : 'no_reliable_match', candidate_id:result.candidate ? result.candidate.type+'/'+result.candidate.id : null } };
  patch.osm_metadata={...patch.osm_metadata,confidence:result.confidence,reasons:result.reasons,ambiguous:result.ambiguous,matched:result.matched};
  patch.evidence=[collectionEvidence('osm',{checked_at:patch.osm_checked_at!,status:result.matched ? 'matched' : result.ambiguous ? 'ambiguous' : 'not_found',confidence:result.confidence,reasons:result.reasons})];
  const website = publicLink(t.website ?? t['contact:website'] ?? '');
  if (!prospect.website_url && website) { patch.website_url = website; patch.has_website = true; patch.evidence!.push({signal:'website_source',source:'osm',value:website}); }
  const phone = (t.phone ?? t['contact:phone'] ?? '').replace(/[^\d+]/g,'');
  if (!prospect.phone && /^\+?\d{9,15}$/.test(phone)) {patch.phone = phone;patch.evidence!.push({signal:'phone',source:'osm',value:phone});}
  for (const platform of ['instagram','facebook','tiktok','whatsapp']) {
    const value = t['contact:'+platform] ?? t[platform]; if (!value) continue;
    const link = publicLink(value); const field = link && socialLink(link);
    if (link && field && !prospect[field]) patch[field] = link;
  }
  await putCache(key,patch,CONFIG.osmDays*86400); return patch;
}
