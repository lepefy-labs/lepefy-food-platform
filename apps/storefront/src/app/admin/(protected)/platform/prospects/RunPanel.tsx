'use client';
import { useRef, useState } from 'react';
import type { Run } from '@/lib/platform/prospects/types';
import { api, Badge, card, dateLabel, secondary } from './ui';
export default function RunPanel({run,onChange}:{run:Run;onChange:(run:Run)=>void}) {
  const busyRef = useRef(false), stopped = useRef(false);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  async function resume() {
    if (busyRef.current) return;
    busyRef.current = true; stopped.current = false; setBusy(true); setError('');
    let current = run;
    try {
      while (!stopped.current && ['pending','running','blocked','failed'].includes(current.status)) {
        if (current.next_attempt_at && Date.parse(current.next_attempt_at) > Date.now()) break;
        current = (await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'step',runId:current.id})})).run;
        onChange(current);
        if (current.status === 'blocked' || current.status === 'failed') break;
        if (['pending','running'].includes(current.status)) await new Promise(resolve => setTimeout(resolve,1200));
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Traitement interrompu.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section className={card+' space-y-3'} aria-label="Avancement du traitement">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{run.kind === 'discovery' ? 'Découverte' : 'Enrichissement'}</h2><Badge value={run.status} /></div>
    <p role="status" className="text-sm">{run.processed} traités · {run.inserted} ajoutés · {run.duplicates} doublons · {run.succeeded} enrichis · {run.blocked} bloqués · {run.failed} incomplets/échecs</p>
    {run.cursor.metrics && <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{Object.entries({
      osm_matches:'Correspondances OSM',osm_ambiguous:'OSM ambigus',website_discovered:'Sites découverts',
      website_crawled:'Sites analysés',website_blocked:'Sites bloqués',google_fallback_used:'Recherches Google',
      google_quota_skipped:'Google suspendu par quota',complete:'Complets',partial:'Partiels',failed:'Échecs',
    }).map(([key,label])=><div key={key}><dt className="text-gray-500">{label}</dt><dd>{run.cursor.metrics?.[key] ?? 0}</dd></div>)}</dl>}
    {run.error && <p className="text-sm text-amber-700">{run.error}</p>}
    {run.next_attempt_at && <p className="text-sm">Nouvelle tentative après {dateLabel(run.next_attempt_at)}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {['pending','running','blocked','failed'].includes(run.status) && <div className="flex flex-wrap items-center gap-3">
      <button className={secondary} disabled={busy || Boolean(run.next_attempt_at && Date.parse(run.next_attempt_at)>Date.now())} onClick={() => void resume()}>{busy ? 'Traitement…' : 'Exécuter / reprendre'}</button>
      {busy && <button className={secondary} onClick={() => {stopped.current = true;}}>Pause après ce lot</button>}
      <span className="text-xs text-gray-500">Gardez cette page ouverte. La progression est conservée.</span>
    </div>}
  </section>;
}
