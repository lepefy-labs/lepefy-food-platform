import { createHash, randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { CONFIG } from './config';
import { identityKey, normalizedDomain, sameIdentity } from './deduplication';
import { scoreProspect } from './scoring';
import type { Identity, Prospect, Run } from './types';
export const db = () => createServiceClient();
export const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class StoreError extends Error { constructor() { super('Données indisponibles. Vérifiez la migration 101 et réessayez.'); } }
export async function getProspect(id:string):Promise<Prospect | null> {
  const result = await db().from('platform_prospects').select('*').eq('id',id).maybeSingle();
  if (result.error) throw new StoreError(); return result.data as Prospect | null;
}
export async function insertCandidate(candidate:Identity) {
  const domain = normalizedDomain(candidate.website_url), key = identityKey(candidate);
  const filters = [candidate.siret ? ['siret',candidate.siret] : null, domain ? ['domain',domain] : null, key ? ['identity_key',key] : null].filter(Boolean) as [string,string][];
  for (const [field,value] of filters) {
    const found = await db().from('platform_prospects').select('*').eq(field,value).limit(100);
    if (found.error) throw new StoreError();
    if ((found.data as Prospect[]).some(p => sameIdentity(p,candidate))) return false;
  }
  const signals = { has_catering:candidate.naf_ape_code === '56.21Z' ? true : null, has_website:candidate.website_url ? true : null };
  const result = await db().from('platform_prospects').insert({ ...candidate, ...signals,
    domain, identity_key:key, ...scoreProspect({ ...candidate,...signals }) });
  if (result.error?.code === '23505') return false;
  if (result.error) throw new StoreError(); return true;
}
export async function patchProspect(id:string, patch:Partial<Prospect>) {
  const result = await db().from('platform_prospects').update(patch).eq('id',id).select('id');
  if (result.error || !result.data?.length) throw new StoreError();
}
export async function getRun(id:string):Promise<Run | null> {
  const r = await db().from('platform_prospect_runs').select('*').eq('id',id).maybeSingle();
  if (r.error) throw new StoreError(); return r.data as Run | null;
}
export async function patchRun(id:string, patch:Partial<Run>) {
  const r = await db().from('platform_prospect_runs').update(patch).eq('id',id);
  if (r.error) throw new StoreError();
}
export async function startRun(kind:Run['kind'], config:Record<string,unknown>):Promise<Run> {
  const signature = hash({kind,config});
  let query = db().from('platform_prospect_runs').select('*').eq('signature',signature).order('created_at',{ascending:false}).limit(1);
  if (kind === 'discovery') query = query.gte('created_at',new Date(Date.now()-CONFIG.sireneDays*86400000).toISOString());
  else query = query.in('status',['pending','running','blocked']);
  const previous = await query;
  if (previous.error) throw new StoreError();
  if (previous.data?.length) return previous.data[0] as Run;
  const r = await db().from('platform_prospect_runs').insert({ kind,signature,config }).select('*').single();
  if (r.error?.code === '23505') {
    const existing = await db().from('platform_prospect_runs').select('*').eq('signature',signature).in('status',['pending','running','blocked']).single();
    if (!existing.error) return existing.data as Run;
  }
  if (r.error) throw new StoreError(); return r.data as Run;
}
export async function getCache<T>(key:string):Promise<T | null> {
  const r = await db().from('platform_prospect_cache').select('payload').eq('key',key).gt('expires_at',new Date().toISOString()).maybeSingle();
  if (r.error) throw new StoreError(); return (r.data?.payload as T) ?? null;
}
export async function putCache(key:string,payload:unknown,seconds:number) {
  const r = await db().from('platform_prospect_cache').upsert({key,payload,expires_at:new Date(Date.now()+seconds*1000).toISOString()});
  if (r.error) throw new StoreError();
}
export async function claimGate(key:string,seconds:number,token=randomUUID()) {
  const r = await db().rpc('claim_platform_prospect_gate',{p_key:key,p_token:token,p_seconds:seconds});
  if (r.error) throw new StoreError(); return r.data ? token : null;
}
export async function releaseGate(key:string,token:string) {
  const r = await db().rpc('release_platform_prospect_gate',{p_key:key,p_token:token});
  if (r.error) throw new StoreError();
}
export async function listProspects(params:URLSearchParams) {
  const page = Math.max(1,Math.min(10000,Number(params.get('page')) || 1));
  let query = db().from('platform_prospects').select('*',{count:'exact'});
  const q = (params.get('q') ?? '').replace(/[^a-zA-Z0-9À-ÿ @.\-]/g,'').slice(0,100).trim();
  if (q) query = query.or(['business_name','city','domain','siret'].map(field => field+'.ilike.%'+q+'%').join(','));
  for (const field of ['status','qualification_level','country','region','department','business_category']) {
    const value = params.get(field); if (value && value.length < 100) query = query.eq(field,value);
  }
  for (const field of ['has_website','has_ecommerce','has_events','has_catering','has_whatsapp_ordering']) {
    const value = params.get(field); if (value === 'true' || value === 'false') query = query.eq(field,value === 'true');
  }
  if (params.get('has_whatsapp') === 'true') query = query.not('whatsapp_url','is',null);
  if (params.get('has_whatsapp') === 'false') query = query.is('whatsapp_url',null);
  if (params.get('outbound') === 'true') query = query.eq('do_not_contact',false).in('status',['discovered','enriched','qualified']);
  const score = Number(params.get('score') ?? 0);
  query = query.gte('fit_score',Number.isFinite(score) ? Math.min(100,Math.max(0,score)) : 0);
  const result = await query.order('fit_score',{ascending:false}).order('id').range((page-1)*CONFIG.pageSize,page*CONFIG.pageSize-1);
  if (result.error) throw new StoreError();
  return { prospects:result.data as Prospect[], total:result.count ?? 0, page, pageSize:CONFIG.pageSize };
}
export async function dashboard() {
  const counts = await Promise.all([
    db().from('platform_prospects').select('id',{count:'exact',head:true}),
    db().from('platform_prospects').select('id',{count:'exact',head:true}).gte('fit_score',CONFIG.qualifiedScore).eq('do_not_contact',false),
    db().from('platform_prospects').select('id',{count:'exact',head:true}).eq('qualification_level','priority').eq('do_not_contact',false),
    ...['contacted','demo','won'].map(status => db().from('platform_prospects').select('id',{count:'exact',head:true}).eq('status',status)),
  ]);
  if (counts.some(r => r.error)) throw new StoreError();
  const runs = await db().from('platform_prospect_runs').select('*').order('created_at',{ascending:false}).limit(5);
  if (runs.error) throw new StoreError();
  return { counts:counts.map(r => r.count ?? 0), runs:runs.data as Run[] };
}
