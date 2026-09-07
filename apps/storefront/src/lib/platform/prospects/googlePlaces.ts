import { db, getCache, putCache, claimGate } from './repository';
import { collection, collectionEvidence, fresh } from './assessment';
import { matchBusiness, type BusinessCandidate } from './matching';
import { publicLink } from './websiteParser';
import type { BusinessLookupProvider } from './businessEnrichment';
export function googleConfig(env:NodeJS.ProcessEnv=process.env) {
  const raw=env.PLATFORM_PROSPECTS_GOOGLE_PLACES_MONTHLY_LIMIT ?? '900';
  const parsed=/^\d+$/.test(raw) ? Number(raw) : 0;
  return {enabled:env.PLATFORM_PROSPECTS_GOOGLE_PLACES_ENABLED==='true' && Boolean(env.GOOGLE_PLACES_API_KEY),
    limit:Number.isSafeInteger(parsed) ? Math.min(10000,parsed) : 0};
}
export function quotaPrefix(now=new Date()) { return 'quota:google:'+now.toISOString().slice(0,7)+':'; }
export type QuotaStore = { last(prefix:string):Promise<number>; insert(key:string,expires:string):Promise<boolean> };
const quotaStore:QuotaStore = {
  async last(prefix) {
    const r=await db().from('platform_prospect_cache').select('key').like('key',prefix+'%').order('key',{ascending:false}).limit(1);
    if (r.error) throw new Error('quota_unavailable');
    const key=r.data?.[0]?.key as string | undefined;
    const n=key ? Number(key.slice(prefix.length)) : 0;
    if (!Number.isSafeInteger(n) || n<0) throw new Error('quota_unavailable');
    return n;
  },
  async insert(key,expires) {
    // INSERT only: a unique slot can never be recycled/refunded in the current month.
    const r=await db().from('platform_prospect_cache').insert({key,payload:{reserved:true},expires_at:expires});
    if (r.error?.code==='23505') return false;
    if (r.error) throw new Error('quota_unavailable');
    return true;
  },
};
export async function reserveGoogleRequest(limit:number,storage:QuotaStore=quotaStore,now=new Date()) {
  if (!Number.isSafeInteger(limit) || limit<=0) return false;
  const prefix=quotaPrefix(now),expires=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+2,1)).toISOString();
  for (let attempt=0;attempt<5;attempt++) {
    const last=await storage.last(prefix);
    if (last>=limit) return false;
    if (await storage.insert(prefix+String(last+1).padStart(6,'0'),expires)) return true;
  }
  return false; // Contention fails closed, never an unreserved request.
}
export async function googleUsage() {
  const config=googleConfig();
  if (!config.enabled) return {...config,used:0,available:true};
  try {return {...config,used:await quotaStore.last(quotaPrefix()),available:true};}
  catch {return {...config,used:null,available:false};}
}
export type GooglePlace = { id?:string; displayName?:{text?:string}; addressComponents?:{longText?:string;types?:string[]}[];
  formattedAddress?:string; location?:{latitude?:number;longitude?:number}; types?:string[]; websiteUri?:string };
export function googleCandidate(p:GooglePlace):BusinessCandidate {
  const component=(type:string)=>p.addressComponents?.find(c=>c.types?.includes(type))?.longText;
  return {id:p.id ?? '',names:[p.displayName?.text ?? ''],postalCode:component('postal_code'),city:component('locality'),
    address:[component('street_number'),component('route')].filter(Boolean).join(' ') || undefined,
    latitude:p.location?.latitude,longitude:p.location?.longitude,
    food:p.types?.length ? p.types.some(t=>/food|restaurant|cater|bakery|grocery|supermarket|butcher|meal/.test(t)) : undefined};
}
export function matchGoogle(p:Parameters<BusinessLookupProvider['lookup']>[0],places:GooglePlace[]) {
  return matchBusiness(p,[...new Map(places.filter(v=>v.id).map(v=>[v.id,v])).values()],googleCandidate);
}
async function requestPlaces(textQuery:string):Promise<GooglePlace[]> {
  // Fixed HTTPS endpoint, server-only key header, no redirects/retries or raw payload logging.
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try {
    const response=await fetch('https://places.googleapis.com/v1/places:searchText',{
      method:'POST',redirect:'error',signal:controller.signal,cache:'no-store',
      headers:{'Content-Type':'application/json','X-Goog-Api-Key':process.env.GOOGLE_PLACES_API_KEY!,
        'X-Goog-FieldMask':'places.id,places.displayName,places.addressComponents,places.location,places.types,places.websiteUri'},
      body:JSON.stringify({textQuery,languageCode:'fr',regionCode:'FR',pageSize:5}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([429,503].includes(response.status)) await putCache('backoff:google',true,3600);
      throw new Error('google_unavailable');
    }
    const reader=response.body?.getReader(); if (!reader) throw new Error('google_empty');
    const chunks:Uint8Array[]=[];let size=0;
    try {
      while (true) {const next=await reader.read();if(next.done)break;size+=next.value.length;
        if(size>128000) {await reader.cancel();throw new Error('google_too_large');}chunks.push(next.value);}
    } finally {reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {places?:GooglePlace[]};
    if (data.places!==undefined && !Array.isArray(data.places)) throw new Error('google_invalid');
    return (data.places ?? []).slice(0,5);
  } finally {clearTimeout(timer);}
}
export function createGoogleProvider(request=requestPlaces,reserve=reserveGoogleRequest):BusinessLookupProvider {
  return {name:'google',async lookup(p) {
    const config=googleConfig(),previous=collection(p,'google');
    const result=(status:string,extra:Record<string,unknown>={})=>({status,patch:{evidence:[collectionEvidence('google',{
      ...previous,status,checked_at:new Date().toISOString(),...extra})]}});
    if (!config.enabled) return {status:'disabled',patch:{evidence:[collectionEvidence('google',{status:'disabled'})]}};
    if (p.website_url) return {status:'website_available',patch:{}};
    if (fresh(previous.checked_at,previous.status==='failed' ? 1/24 : 30)) return {status:'cooldown',patch:{}};
    if (!p.postal_code || !p.city) return result('insufficient_identity');
    if (await getCache('backoff:google') || !await claimGate('provider:google',2)) return {status:'cooldown',patch:{}};
    try {
      if (!await reserve(config.limit)) return {status:'quota_exhausted',patch:{evidence:[collectionEvidence('google',{status:'quota_exhausted'})]}};
    } catch {return {status:'quota_unavailable',patch:{evidence:[collectionEvidence('google',{status:'quota_unavailable'})]}};}
    try {
      const candidates=await request([p.business_name,p.address,p.postal_code,p.city,'France'].filter(Boolean).join(' ').slice(0,600));
      const match=matchGoogle(p,candidates),place=match.matched ? match.candidate : null;
      const value=result(place ? 'matched' : match.ambiguous ? 'ambiguous' : 'not_found',{
        place_id:place?.id,confidence:match.confidence,reasons:match.reasons});
      // Google fields are transient. Only place ID + our lookup diagnostics persist.
      return {...value,transientWebsite:place ? publicLink(place.websiteUri ?? '') ?? undefined : undefined};
    } catch { return result('failed'); }
  }};
}
export const googleProvider=createGoogleProvider();
