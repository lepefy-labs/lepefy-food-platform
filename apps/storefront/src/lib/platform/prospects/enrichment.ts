import { enrichOsm } from './osm';
import { googleProvider } from './googlePlaces';
import { enrichWebsite } from './website';
import { mergeEnrichment } from './mergeEnrichment';
import { assessProspect, collection, collectionEvidence, mergeEvidence } from './assessment';
import { nameSimilarity } from './matching';
import { normalizedDomain } from './deduplication';
import { scoreProspect } from './scoring';
import type { BusinessLookupProvider } from './businessEnrichment';
import type { Prospect } from './types';
export const osmProvider:BusinessLookupProvider={name:'osm',async lookup(p) {
  const patch=await enrichOsm(p);
  return {patch,status:String(patch.osm_metadata?.matched ? 'matched' : patch.osm_metadata?.result ?? 'skipped')};
}};
type Dependencies={free:BusinessLookupProvider;fallback:BusinessLookupProvider;website:typeof enrichWebsite};
export async function enrichProspect(p:Prospect,deps:Dependencies={free:osmProvider,fallback:googleProvider,website:enrichWebsite},freeEnabled=true) {
  const metrics={osm_matches:0,osm_not_found:0,osm_ambiguous:0,osm_failed:0,osm_skipped:0,
    website_discovered:0,website_crawled:0,website_partial:0,website_blocked:0,website_failed:0,website_unresolved:0,
    google_fallback_used:0,google_disabled:0,google_not_found:0,google_ambiguous:0,google_failed:0,google_quota_skipped:0,
    complete:0,partial:0,failed:0};
  let combined={...p},patch:Partial<Prospect>={},crawled:string | null=null;
  const apply=(next:Partial<Prospect>)=>{
    const safe=mergeEnrichment(combined,next);patch={...patch,...safe};combined={...combined,...safe};
  };
  const crawl=async()=>{
    if (!combined.website_url || crawled===combined.website_url) return;
    crawled=combined.website_url;
    try {
      const next=await deps.website(combined);
      if(next.crawl_status==='completed')metrics.website_crawled++;
      if(next.crawl_status==='partial')metrics.website_partial++;
      if(next.crawl_status==='blocked')metrics.website_blocked++;
      if(next.crawl_status==='failed')metrics.website_failed++;
      apply(next);
    } catch {
      metrics.website_failed++;
      apply({crawl_status:'failed',evidence:[collectionEvidence('website',{status:'failed',checked_at:new Date().toISOString(),
        error:'request_failed',website_url:combined.website_url,retry_at:new Date(Date.now()+3600000).toISOString()})]});
    }
  };
  // A known public site is the first free source.
  await crawl();
  const manualNoWebsite=collection(combined,'manual').status==='verified' && collection(combined,'manual').website_url==='';
  if (freeEnabled && !manualNoWebsite && (!combined.website_url || !combined.phone)) {
    try {
      const result=await deps.free.lookup(combined);
      if(result.status==='matched' || result.patch.osm_metadata?.matched)metrics.osm_matches++;
      else if(result.status==='ambiguous' || result.patch.osm_metadata?.ambiguous)metrics.osm_ambiguous++;
      else if(result.status==='not_found' || result.status==='no_reliable_match')metrics.osm_not_found++;
      else metrics.osm_skipped++;
      if(!combined.website_url && result.patch.website_url)metrics.website_discovered++;
      apply(result.patch);
    } catch {
      metrics.osm_failed++;
      apply({evidence:[collectionEvidence('osm',{status:'failed',checked_at:new Date().toISOString(),error:'source_unavailable'})]});
    }
  } else if (freeEnabled) metrics.osm_skipped++;
  await crawl();
  // Never pay just to fill one missing field when a site is already available.
  if (!combined.website_url && !manualNoWebsite) {
    try {
      const result=await deps.fallback.lookup(combined);
      if(['matched','not_found','ambiguous','failed'].includes(result.status))metrics.google_fallback_used++;
      if(result.status==='disabled')metrics.google_disabled++;
      if(result.status==='not_found')metrics.google_not_found++;
      if(result.status==='ambiguous')metrics.google_ambiguous++;
      if(result.status==='failed')metrics.google_failed++;
      if(result.status.startsWith('quota_'))metrics.google_quota_skipped++;
      apply(result.patch);
      if(result.transientWebsite) {
        // No Google URL/phone/address is persisted from the response or a failed crawl.
        const website=await deps.website({...combined,website_url:result.transientWebsite,website_checked_at:null},{cache:false});
        const name=website.website_title ?? '';
        const identity=Math.max(nameSimilarity(combined.business_name,name),nameSimilarity(combined.legal_name ?? '',name));
        if (website.crawl_status==='completed' && identity>=0.65) {
          apply({...website,website_url:result.transientWebsite,has_website:true,
            evidence:mergeEvidence(website.evidence,[{signal:'website_source',source:'website',value:'Site vérifié directement après recherche Google Maps'}])});
          metrics.website_discovered++;metrics.website_crawled++;
        } else {
          apply({evidence:[collectionEvidence('google',{...collection(combined,'google'),status:'website_unverified'})]});
          if(website.crawl_status==='partial')metrics.website_partial++;
          if(website.crawl_status==='blocked')metrics.website_blocked++;
          if(website.crawl_status==='failed')metrics.website_failed++;
        }
      }
    } catch { metrics.google_failed++; /* Optional fallback must not discard free-source evidence. */ }
  }
  if (!combined.website_url) metrics.website_unresolved++;
  patch.last_enriched_at=new Date().toISOString();
  if (!combined.website_url && combined.crawl_status==='pending') patch.crawl_status='partial';
  if (combined.naf_ape_code==='56.21Z') patch.has_catering=true;
  for (const [signal,url] of [['has_instagram','instagram_url'],['has_facebook','facebook_url'],['has_tiktok','tiktok_url']] as const) {
    if(combined[url])patch[signal]=true;
  }
  patch.domain=normalizedDomain(combined.website_url);
  combined={...combined,...patch};
  Object.assign(patch,scoreProspect(combined));
  const assessment=assessProspect(combined);
  if(assessment.enrichment_status==='complete')metrics.complete++;
  else if(assessment.enrichment_status==='failed')metrics.failed++;
  else metrics.partial++;
  const last=collection(combined,'website');
  return {patch,assessment,metrics,latestWebsiteStatus:last.status};
}
