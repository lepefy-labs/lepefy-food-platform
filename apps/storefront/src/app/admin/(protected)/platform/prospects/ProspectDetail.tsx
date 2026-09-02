'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { STATUSES, type Prospect, type Run } from '@/lib/platform/prospects/types';
import { STATUS_LABELS } from '@/lib/platform/prospects/config';
import { api, Badge, button, card, dateLabel, ExternalLink, field, secondary } from './ui';
import RunPanel from './RunPanel';
const localDate = (s:string | null) => { if (!s) return ''; const d = new Date(s); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
export default function ProspectDetail({id}:{id:string}) {
  const [p,setP] = useState<Prospect | null>(null), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [run,setRun] = useState<Run | null>(null);
  const load = useCallback(async () => {
    try { setP((await api<{prospect:Prospect}>('/api/admin/platform/prospects/'+id)).prospect); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); }
  },[id]);
  useEffect(() => { void load(); },[load]);
  async function enrich() {
    setBusy(true); setError('');
    try { setRun((await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enrich',ids:[id],osm:true})})).run); }
    catch (e) { setError(e instanceof Error ? e.message : 'Enrichissement indisponible.'); } finally { setBusy(false); }
  }
  async function save(form:HTMLFormElement) {
    const f = new FormData(form), text = (key:string) => String(f.get(key) ?? '').trim() || null;
    const date = (key:string) => text(key) ? new Date(text(key)!).toISOString() : null;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/admin/platform/prospects/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        status:text('status'),website_url:text('website_url'),last_contact_at:date('last_contact_at'),next_action_at:date('next_action_at'),
        notes:text('notes'),lost_reason:text('lost_reason'),do_not_contact:f.has('do_not_contact'),suppression_reason:text('suppression_reason'),
      })}); setNotice('Fiche enregistrée.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-6xl space-y-5 text-gray-950 dark:text-gray-100">
    <Link className={secondary} href="/admin/platform/prospects">← Prospects</Link>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}
    {!p ? <button className={secondary} onClick={() => void load()}>Charger la fiche</button> : <>
      <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-violet-600">Plateforme · Prospect</p>
        <h1 className="mt-1 text-2xl font-semibold">{p.business_name}</h1><p className="mt-1 text-sm text-gray-500">{p.business_category ?? 'Catégorie non renseignée'} · {p.city} {p.postal_code}</p>
        <p className="mt-3 flex flex-wrap items-center gap-2"><strong>{p.fit_score}/100</strong><Badge value={p.qualification_level} /><Badge value={p.status} />{p.do_not_contact && <span className="text-sm font-semibold text-red-700">Ne pas contacter</span>}</p></div>
        <button className={button} disabled={busy || p.do_not_contact} onClick={() => void enrich()}>Enrichir ce prospect</button>
      </header>
      {run && <RunPanel key={run.id} run={run} onChange={r => {setRun(r);if (['completed','partial','failed'].includes(r.status)) void load();}} />}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card+' space-y-3'}><h2 className="font-semibold">Identité et contacts publics</h2>
          <p className="text-sm">{p.legal_name ?? p.business_name}<br />{p.address ?? 'Adresse non renseignée'}</p>
          <dl className="grid gap-3 text-sm">
            <div><dt className="text-gray-500">Site</dt><dd><ExternalLink href={p.website_url}>{p.website_url}</ExternalLink></dd></div>
            <div><dt className="text-gray-500">Téléphone professionnel</dt><dd>{p.phone ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Email professionnel public</dt><dd>{p.public_email ?? '—'}</dd></div>
            {(['instagram_url','facebook_url','tiktok_url','whatsapp_url'] as const).map(key => <div key={key}><dt className="capitalize text-gray-500">{key.replace('_url','')}</dt><dd><ExternalLink href={p[key]}>{p[key]}</ExternalLink></dd></div>)}
          </dl>
        </section>
        <section className={card+' space-y-3'}><h2 className="font-semibold">Présence digitale</h2>
          <p className="text-sm text-gray-500">« Non détecté » décrit uniquement les pages inspectées. Un accès bloqué reste non vérifiable.</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([['has_ecommerce','Ecommerce'],['has_online_ordering','Commande en ligne'],['has_delivery','Livraison'],['has_whatsapp_ordering','Commande WhatsApp'],['has_events','Événements'],['has_catering','Traiteur'],['has_loyalty','Fidélité'],['has_multiple_locations','Plusieurs établissements']] as const).map(([key,label]) => <div key={key}><dt className="text-gray-500">{label}</dt><dd>{p[key] === true ? 'Détecté' : p[key] === false ? 'Non détecté' : 'Non vérifié'}</dd></div>)}
          </dl>
          <p className="text-sm">Technologies : {p.technologies.join(', ') || 'Non identifiées'}</p>
          {p.website_title && <p className="text-sm">{p.website_title}</p>}{p.website_description && <p className="text-sm text-gray-500">{p.website_description}</p>}
        </section>
        <section className={card+' space-y-3 lg:col-span-2'}><h2 className="font-semibold">Analyse Lepefy</h2>
          <div className="grid gap-5 md:grid-cols-3">
            <div><h3 className="mb-2 text-sm font-medium">Score explicable</h3><ul className="space-y-1 text-sm">{p.score_breakdown.map(r => <li key={r.rule}>{r.rule} : +{r.points}</li>)}</ul><p className="mt-2 text-xs text-gray-500">Score plafonné à 100.</p></div>
            <div><h3 className="mb-2 text-sm font-medium">Observations</h3>{p.detected_problems.length ? <ul className="list-inside list-disc space-y-2 text-sm">{p.detected_problems.map(v => <li key={v}>{v}</li>)}</ul> : <p className="text-sm text-gray-500">Preuves insuffisantes.</p>}</div>
            <div><h3 className="mb-2 text-sm font-medium">Modules recommandés</h3><ul className="space-y-2 text-sm">{p.recommended_modules.map(v => <li key={v}>{v}</li>)}</ul></div>
          </div>
          <p className="text-xs text-gray-500">{p.qualification_reason}</p>
          <details><summary className="min-h-11 cursor-pointer text-sm">Preuves et sources inspectées ({p.evidence.length})</summary><ul className="space-y-2 text-sm">{p.evidence.map((e,i) => <li key={i}>{e.signal} · {e.value} · <ExternalLink href={e.source}>Source</ExternalLink></li>)}</ul></details>
        </section>
        <section className={card+' lg:col-span-2'}><h2 className="mb-4 font-semibold">Suivi commercial</h2>
          <form key={p.updated_at} className="grid gap-3 sm:grid-cols-2" onSubmit={e => {e.preventDefault();void save(e.currentTarget);}}>
            <label className="text-sm">Statut<select className={field} name="status" defaultValue={p.status}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
            <label className="text-sm">Site professionnel (vérifié manuellement)<input className={field} name="website_url" type="url" defaultValue={p.website_url ?? ''} maxLength={2048} placeholder="https://…" /></label>
            <label className="text-sm">Dernier contact<input className={field} name="last_contact_at" type="datetime-local" defaultValue={localDate(p.last_contact_at)} /></label>
            <label className="text-sm">Prochaine action<input className={field} name="next_action_at" type="datetime-local" defaultValue={localDate(p.next_action_at)} /></label>
            <label className="text-sm sm:col-span-2">Notes professionnelles<textarea className={field} name="notes" rows={4} maxLength={10000} defaultValue={p.notes ?? ''} /></label>
            <label className="text-sm">Motif de perte<input className={field} name="lost_reason" maxLength={1000} defaultValue={p.lost_reason ?? ''} /></label>
            <label className="text-sm">Motif d’opposition<input className={field} name="suppression_reason" maxLength={1000} defaultValue={p.suppression_reason ?? ''} /></label>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input name="do_not_contact" type="checkbox" defaultChecked={p.do_not_contact} />Ne pas contacter — exclure des candidats</label>
            <button className={button} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </form>
        </section>
        <section className={card+' space-y-3 lg:col-span-2'}><h2 className="font-semibold">Sources et collecte</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">{[
            ['Source',p.discovery_source],['SIRET',p.siret],['SIREN',p.siren],['APE',p.naf_ape_code],
            ['Découverte',dateLabel(p.discovered_at)],['Dernier enrichissement',dateLabel(p.last_enriched_at)],
            ['Dernier site complet',dateLabel(p.website_checked_at)],['Dernier OSM',dateLabel(p.osm_checked_at)],['Opposition',dateLabel(p.suppressed_at)],
          ].map(([k,v]) => <div key={k}><dt className="text-gray-500">{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
          <p className="text-sm"><Badge value={p.crawl_status} /> HTTP {p.crawl_http_status ?? '—'} {p.crawl_error ?? ''}</p>
          {Object.keys(p.osm_metadata).length > 0 && <p className="text-xs text-gray-500">OpenStreetMap contributors · ODbL · {String(p.osm_metadata.id ?? p.osm_metadata.result ?? '')}</p>}
        </section>
      </div>
    </>}
  </div>;
}
