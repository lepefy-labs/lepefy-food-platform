'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CONFIG, FOOD_CODES, REGIONS, STATUS_LABELS } from '@/lib/platform/prospects/config';
import { STATUSES, type Prospect, type Run } from '@/lib/platform/prospects/types';
import DiscoveryForm from './DiscoveryForm';
import RunPanel from './RunPanel';
import { api, Badge, button, card, dateLabel, ExternalLink, field, secondary } from './ui';
type Snapshot = {prospects:Prospect[];total:number;page:number;pageSize:number;counts:number[];runs:Run[]};
export default function ProspectsClient() {
  const [data,setData] = useState<Snapshot | null>(null), [query,setQuery] = useState(''), [selected,setSelected] = useState<string[]>([]);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [run,setRun] = useState<Run | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api<Snapshot>('/api/admin/platform/prospects?'+query); setData(result); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); } finally { setLoading(false); }
  },[query]);
  useEffect(() => { void load(); setSelected([]); },[load]);
  function changeRun(value:Run) {
    setRun(value); if (['completed','partial','failed'].includes(value.status)) void load();
  }
  async function enrich(qualified=false) {
    setBusy(true); setError('');
    try { changeRun((await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'enrich',...(qualified ? {qualified:true} : {ids:selected}),osm:true})})).run); }
    catch (e) { setError(e instanceof Error ? e.message : 'Enrichissement indisponible.'); } finally { setBusy(false); }
  }
  const toggle = (id:string) => setSelected(old => old.includes(id) ? old.filter(x => x !== id) : old.length < CONFIG.enrichmentBatch ? [...old,id] : old);
  const page = (n:number) => { const p = new URLSearchParams(query); p.set('page',String(n)); setQuery(p.toString()); };
  return <div className="mx-auto max-w-7xl space-y-5 text-gray-950 dark:text-gray-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Plateforme</p>
      <h1 className="mt-1 text-2xl font-semibold">Prospects</h1><p className="mt-1 text-sm text-gray-500">Identifier les futurs tenants et préparer un contact individuel.</p></div>
      <Link href="/admin/platform" className={secondary}>Console Lepefy</Link></header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{['Total','Qualifiés ≥ 65','Prioritaires','Contactés','Démo','Gagnés'].map((label,i) => <div className={card} key={label}><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold">{data?.counts[i] ?? '—'}</p></div>)}</div>
    <DiscoveryForm onRun={changeRun} />
    {run && <RunPanel key={run.id} run={run} onChange={changeRun} />}
    {data?.runs.length ? <details className={card}><summary className="cursor-pointer text-sm font-medium">Traitements récents</summary>
      {data.runs.map(r => <button key={r.id} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" onClick={() => setRun(r)}>
        <span>{r.kind === 'discovery' ? 'Découverte' : 'Enrichissement'} · {dateLabel(r.created_at)}</span><Badge value={r.status} /></button>)}</details> : null}
    <form className={card+' space-y-3'} onSubmit={e => {e.preventDefault();const p = new URLSearchParams();new FormData(e.currentTarget).forEach((v,k) => {if (String(v)) p.set(k,String(v));});setQuery(p.toString());}}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm lg:col-span-2">Recherche<input name="q" className={field} placeholder="Commerce, ville, domaine, SIRET" maxLength={100} /></label>
        <label className="text-sm">Statut<select name="status" className={field}><option value="">Tous</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
        <label className="text-sm">Score minimum<input name="score" className={field} type="number" min={0} max={100} defaultValue={0} /></label>
      </div>
      <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Filtres avancés</summary>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Qualification<select className={field} name="qualification_level"><option value="">Toutes</option>{['low','medium','high','priority'].map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
          <label className="text-sm">Pays<input className={field} name="country" placeholder="FR" maxLength={2} /></label>
          <label className="text-sm">Région<select className={field} name="region"><option value="">Toutes</option>{Object.entries(REGIONS).map(([c,n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="text-sm">Département<input className={field} name="department" maxLength={3} /></label>
          <label className="text-sm">Catégorie<select className={field} name="business_category"><option value="">Toutes</option>{Object.values(FOOD_CODES).map(c => <option key={c}>{c}</option>)}</select></label>
          {[['has_website','Site'],['has_ecommerce','Ecommerce'],['has_events','Événements'],['has_catering','Traiteur'],['has_whatsapp','WhatsApp']].map(([name,label]) => <label className="text-sm" key={name}>{label}<select className={field} name={name}><option value="">Tous</option><option value="true">Détecté</option><option value="false">Non détecté</option></select></label>)}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="outbound" value="true" />Candidats à contacter uniquement</label>
        </div>
      </details>
      <button className={button} disabled={loading}>Appliquer les filtres</button>
    </form>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}<button className={secondary+' ml-3'} onClick={() => void load()}>Réessayer</button></div>}
    <section className={card+' space-y-4'} aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-semibold">{data?.total ?? '—'} prospects</h2>
        <button className={secondary} disabled={busy || !selected.length} onClick={() => void enrich()}>Enrichir la sélection ({selected.length}/{CONFIG.enrichmentBatch})</button>
        <button className={secondary} disabled={busy} onClick={() => void enrich(true)}>Enrichir les qualifiés (max. {CONFIG.enrichmentBatch})</button></div>
      {loading && <p role="status" className="text-sm text-gray-500">Chargement…</p>}
      {!loading && data?.prospects.length === 0 && <p className="py-8 text-center text-sm text-gray-500">Aucun prospect pour ces filtres. Lancez une découverte ou ajustez la recherche.</p>}
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700">
        {['Sélection','Commerce','Catégorie','Localisation','Site','Score','Qualification','Statut','Enrichissement','Actions'].map(c => <th className="px-2 py-3 font-medium" key={c}>{c}</th>)}</tr></thead>
        <tbody>{data?.prospects.map(p => <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
          <td className="px-2 py-3"><input aria-label={'Sélectionner '+p.business_name} type="checkbox" disabled={p.do_not_contact || (!selected.includes(p.id) && selected.length>=CONFIG.enrichmentBatch)} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /></td>
          <td className="min-w-40 px-2 py-3 font-medium"><Link className="text-violet-700 dark:text-violet-300" href={'/admin/platform/prospects/'+p.id}>{p.business_name}</Link>{p.do_not_contact && <p className="text-xs text-red-700">Ne pas contacter</p>}</td>
          <td className="px-2 py-3">{p.business_category ?? '—'}</td><td className="px-2 py-3">{p.city ?? '—'}<p className="text-xs text-gray-500">{p.postal_code}</p></td>
          <td className="max-w-40 px-2 py-3"><ExternalLink href={p.website_url}>{p.domain ?? 'Site'}</ExternalLink></td>
          <td className="px-2 py-3 font-semibold">{p.fit_score}/100</td><td className="px-2 py-3"><Badge value={p.qualification_level} /></td><td className="px-2 py-3"><Badge value={p.status} /></td>
          <td className="px-2 py-3 text-xs">{dateLabel(p.last_enriched_at)}<p><Badge value={p.crawl_status} /></p></td><td className="px-2 py-3"><Link className={secondary} href={'/admin/platform/prospects/'+p.id}>Voir</Link></td>
        </tr>)}</tbody></table></div>
      <div className="space-y-3 md:hidden">{data?.prospects.map(p => <article className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700" key={p.id}>
        <div className="flex items-center gap-3"><input type="checkbox" aria-label={'Sélectionner '+p.business_name} checked={selected.includes(p.id)} disabled={p.do_not_contact || (!selected.includes(p.id) && selected.length>=CONFIG.enrichmentBatch)} onChange={() => toggle(p.id)} /><Link className="font-semibold text-violet-700 dark:text-violet-300" href={'/admin/platform/prospects/'+p.id}>{p.business_name}</Link></div>
        <p className="text-sm">{p.business_category} · {p.city}</p><p className="flex flex-wrap items-center gap-2"><strong>{p.fit_score}/100</strong><Badge value={p.qualification_level} /><Badge value={p.status} /></p>
        <p className="text-xs text-gray-500">Enrichissement : {dateLabel(p.last_enriched_at)}</p>{p.do_not_contact && <p className="text-sm text-red-700">Ne pas contacter</p>}
        <Link className={secondary} href={'/admin/platform/prospects/'+p.id}>Voir la fiche</Link>
      </article>)}</div>
      {data && <div className="flex items-center justify-between gap-3"><button className={secondary} disabled={loading || data.page<=1} onClick={() => page(data.page-1)}>Précédent</button>
        <span className="text-sm">Page {data.page} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button className={secondary} disabled={loading || data.page*data.pageSize>=data.total} onClick={() => page(data.page+1)}>Suivant</button></div>}
    </section>
  </div>;
}
