import { CONFIG } from './config';
import { enrichProspect } from './enrichment';
import { assessProspect, collection } from './assessment';
import { sireneProvider } from './sirene';
import { db, getRun, getProspect, patchRun, patchEnrichment, insertCandidate, claimGate, releaseGate, StoreError } from './repository';
import { CrawlError } from './websiteFetcher';
import type { DiscoveryFilters, DiscoveryProvider, Run } from './types';

export async function selectEnrichment(ids?:string[],unverified=false):Promise<string[]> {
  let query=db().from('platform_prospects').select('*').eq('do_not_contact',false);
  if (ids?.length) query=query.in('id',ids);
  else if (unverified) query=query.in('status',['discovered','enriched','qualified']);
  else throw new Error('Sélectionnez des prospects.');
  // Scan in bounded DB pages so cooling records never starve later candidates.
  const candidates:string[]=[];
  for(let offset=0;offset<5000 && candidates.length<CONFIG.enrichmentBatch;offset+=100) {
    const r=await query.order('last_enriched_at',{ascending:true,nullsFirst:true})
      .order('has_catering',{ascending:false,nullsFirst:false})
      .order('has_multiple_locations',{ascending:false,nullsFirst:false})
      .order('latitude',{ascending:true,nullsFirst:false}).order('id').range(offset,offset+99);
    if(r.error)throw new StoreError();
    const rows=(r.data ?? []) as import('./types').Prospect[];
    for(const p of rows) {
      const a=assessProspect(p),w=collection(p,'website');
      if(a.enrichment_status==='complete' || (w.retry_at && Date.parse(w.retry_at)>Date.now()))continue;
      // No unresolved-website hot loop: at least one hour between attempts.
      if(p.last_enriched_at && Date.parse(p.last_enriched_at)>Date.now()-CONFIG.retryMinutes*60000)continue;
      candidates.push(p.id);if(candidates.length===CONFIG.enrichmentBatch)break;
    }
    if(rows.length<100 || ids?.length)break;
  }
  return candidates;
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
          const candidate = pending[0]; if (!candidate) break;
          if (await insertCandidate(candidate)) run.inserted++; else run.duplicates++;
          run.processed++; pending = pending.slice(1);
          await patchRun(id,{inserted:run.inserted,duplicates:run.duplicates,processed:run.processed,cursor:{pending,page,exhausted}});
        }
        const done = run.processed >= filters.limit || (exhausted && !pending.length);
        await patchRun(id,{status:done ? 'completed' : 'running',cursor:{pending:done ? [] : pending,page,exhausted}});
      } else {
        const ids = run.config.ids as string[], index = run.cursor.index ?? 0;
        const prospect = ids[index] ? await getProspect(ids[index]) : null;
        if (prospect && !prospect.do_not_contact) {
          const result=await enrichProspect(prospect,undefined,run.config.osm!==false);
          const patch={...result.patch};
          if (['discovered','enriched'].includes(prospect.status)) patch.status=result.assessment.score_state==='enriched'
            && result.patch.fit_score!>=CONFIG.qualifiedScore ? 'qualified' : 'enriched';
          // One compare-and-set covers data and qualification; manual edits win.
          await patchEnrichment(prospect,patch);
          if(result.assessment.enrichment_status==='complete')run.succeeded++;
          else if(result.latestWebsiteStatus==='blocked')run.blocked++;
          else run.failed++;
          const metrics={...(run.cursor.metrics ?? {})};
          for(const [key,value] of Object.entries(result.metrics))metrics[key]=(metrics[key] ?? 0)+value;
          run.cursor.metrics=metrics;
        }
        run.processed++;
        const done = index+1 >= ids.length;
        await patchRun(id,{ processed:run.processed,succeeded:run.succeeded,blocked:run.blocked,failed:run.failed,
          cursor:{index:index+1,metrics:run.cursor.metrics},status:done ? (run.failed || run.blocked ? 'partial' : 'completed') : 'running' });
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
