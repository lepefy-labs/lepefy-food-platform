import { CONFIG } from './config';
import { normalizedDomain } from './deduplication';
import { enrichOsm } from './osm';
import { enrichWebsite } from './website';
import { sireneProvider } from './sirene';
import { scoreProspect } from './scoring';
import { db, getRun, getProspect, patchRun, patchProspect, insertCandidate, claimGate, releaseGate, StoreError } from './repository';
import { CrawlError } from './websiteFetcher';
import type { DiscoveryFilters, DiscoveryProvider, Prospect, Run } from './types';

export async function selectEnrichment(ids?:string[],qualified=false):Promise<string[]> {
  let query = db().from('platform_prospects').select('id').eq('do_not_contact',false)
    .or('website_checked_at.is.null,website_checked_at.lt.'+new Date(Date.now()-CONFIG.websiteDays*86400000).toISOString());
  if (ids?.length) query = query.in('id',ids);
  else if (qualified) query = query.gte('fit_score',CONFIG.qualifiedScore).in('status',['discovered','enriched','qualified']);
  else throw new Error('Sélectionnez des prospects.');
  const r = await query.order('fit_score',{ascending:false}).limit(CONFIG.enrichmentBatch);
  if (r.error) throw new StoreError(); return (r.data ?? []).map(p => p.id as string);
}
export async function stepRun(id:string,provider:DiscoveryProvider=sireneProvider):Promise<Run> {
  // Serverless-safe serialization across all runs. No unattended or unbounded workers.
  const lease = await claimGate('pipeline',180);
  if (!lease) throw new CrawlError('pipeline_busy',429,5);
  try {
    const run = await getRun(id); if (!run) throw new Error('Exécution introuvable.');
    if (['completed','partial'].includes(run.status)) return run;
    if (run.next_attempt_at && Date.parse(run.next_attempt_at) > Date.now()) return run;
    await patchRun(id,{status:'running',error:null,next_attempt_at:null});
    try {
      if (run.kind === 'discovery') {
        const filters = run.config as unknown as DiscoveryFilters;
        let pending = run.cursor.pending ?? [], page = run.cursor.page ?? 1, exhausted = run.cursor.exhausted ?? false;
        if (!pending.length && !exhausted && page > CONFIG.maxDiscoveryPages) {
          await patchRun(id,{status:'partial',error:'Limite de pages atteinte. Affinez la zone ou les activités.'});
          return (await getRun(id))!;
        }
        if (!pending.length && !exhausted) {
          const result = await provider.discover(filters,page); pending = result.candidates;
          exhausted = result.nextPage === null; page = result.nextPage ?? page;
        }
        const take = Math.min(CONFIG.discoveryBatch,filters.limit-run.processed,pending.length);
        // Persist a cursor after each candidate. On crash, a replay can only deduplicate.
        for (let i=0;i<take;i++) {
          if (await insertCandidate(pending[0])) run.inserted++; else run.duplicates++;
          run.processed++; pending = pending.slice(1);
          await patchRun(id,{inserted:run.inserted,duplicates:run.duplicates,processed:run.processed,cursor:{pending,page,exhausted}});
        }
        const done = run.processed >= filters.limit || (exhausted && !pending.length);
        await patchRun(id,{status:done ? 'completed' : 'running',cursor:{pending:done ? [] : pending,page,exhausted}});
      } else {
        const ids = run.config.ids as string[], index = run.cursor.index ?? 0;
        const prospect = ids[index] ? await getProspect(ids[index]) : null;
        if (prospect && !prospect.do_not_contact) {
          let patch:Partial<Prospect> = {}, osmError = false;
          if (run.config.osm) {
            try { patch = await enrichOsm(prospect); } catch { osmError = true; }
          }
          try { patch = { ...patch,...await enrichWebsite({...prospect,...patch}) }; }
          catch { patch.crawl_status = 'failed'; patch.crawl_error = 'request_failed'; }
          patch.last_enriched_at = new Date().toISOString();
          patch.domain = normalizedDomain(patch.website_url ?? prospect.website_url);
          const combined = { ...prospect,...patch };
          patch.has_instagram = Boolean(combined.instagram_url) || null;
          patch.has_facebook = Boolean(combined.facebook_url) || null;
          patch.has_tiktok = Boolean(combined.tiktok_url) || null;
          if (combined.naf_ape_code === '56.21Z') patch.has_catering = true;
          if (!patch.crawl_status) patch.crawl_status = combined.website_checked_at ? combined.crawl_status : 'partial';
          if (osmError && patch.crawl_status === 'completed') patch.crawl_status = 'partial';
          if (osmError && !patch.crawl_error) patch.crawl_error = 'osm_unavailable';
          Object.assign(patch,scoreProspect({...combined,...patch}));
          // Sales fields are never overwritten by enrichment, including concurrent manual edits.
          await patchProspect(prospect.id,patch);
          if (['discovered','enriched'].includes(prospect.status)) {
            const r = await db().from('platform_prospects').update({status:patch.fit_score! >= CONFIG.qualifiedScore ? 'qualified' : 'enriched'})
              .eq('id',prospect.id).in('status',['discovered','enriched']).eq('do_not_contact',false);
            if (r.error) throw new StoreError();
          }
          if (patch.crawl_status === 'blocked') run.blocked++;
          else if (patch.crawl_status === 'failed') run.failed++;
          else if (patch.crawl_status === 'partial') run.failed++;
          else run.succeeded++;
        }
        run.processed++;
        const done = index+1 >= ids.length;
        await patchRun(id,{ processed:run.processed,succeeded:run.succeeded,blocked:run.blocked,failed:run.failed,
          cursor:{index:index+1},status:done ? (run.failed || run.blocked ? 'partial' : 'completed') : 'running' });
      }
    } catch (e) {
      const wait = e instanceof CrawlError ? e.retrySeconds : 0;
      await patchRun(id,{status:wait ? 'blocked' : 'failed', error:e instanceof StoreError ? e.message : e instanceof CrawlError ? e.code : 'Source indisponible. Réessayez plus tard.',
        next_attempt_at:wait ? new Date(Date.now()+wait*1000).toISOString() : null });
    }
    const result = await getRun(id);
    if (!result) throw new StoreError();
    console.info('platform_prospects_run',{kind:result.kind,status:result.status,processed:result.processed,
      inserted:result.inserted,duplicates:result.duplicates,succeeded:result.succeeded,blocked:result.blocked,failed:result.failed});
    return result;
  } finally { await releaseGate('pipeline',lease); }
}
