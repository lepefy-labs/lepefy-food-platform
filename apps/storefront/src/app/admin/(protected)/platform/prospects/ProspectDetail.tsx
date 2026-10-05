'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { STATUSES, type Prospect, type Run, type SalesStatus } from '@/lib/platform/prospects/types';
import { STATUS_LABELS } from '@/lib/platform/prospects/config';
import { CLOSED_STATUSES, contactLinks, NOTE_MAX, presetFollowUp, salesIssues } from '@/lib/platform/prospects/salesPipeline';
import { api, Badge, button, card, dateLabel, ExternalLink, field, secondary } from './ui';
import { Fit, Completeness, Qualification, CollectionStatus, FollowUp } from './Quality';
import { assessProspect, collection, QUALITY_LABELS, PROVIDER_LABELS } from '@/lib/platform/prospects/assessment';
import RunPanel from './RunPanel';

const localDate = (s:string | null) => { if (!s) return ''; const d = new Date(s); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const toIso = (local:string) => local ? new Date(local).toISOString() : null;
const toLocal = (d:Date) => localDate(d.toISOString());

type SalesForm = {
  status:SalesStatus; website_url:string; last_contact_at:string; next_action_at:string; notes:string;
  lost_reason:string; do_not_contact:boolean; suppression_reason:string; append_note:string;
};
const formOf = (p:Prospect):SalesForm => ({
  status:p.status, website_url:p.website_url ?? '', last_contact_at:localDate(p.last_contact_at), next_action_at:localDate(p.next_action_at),
  notes:p.notes ?? '', lost_reason:p.lost_reason ?? '', do_not_contact:p.do_not_contact, suppression_reason:p.suppression_reason ?? '', append_note:'',
});

export default function ProspectDetail({id}:{id:string}) {
  const [p,setP] = useState<Prospect | null>(null), [form,setForm] = useState<SalesForm | null>(null);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [run,setRun] = useState<Run | null>(null);
  const load = useCallback(async () => {
    try { const prospect=(await api<{prospect:Prospect}>('/api/admin/platform/prospects/'+id)).prospect; setP(prospect); setForm(formOf(prospect)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); }
  },[id]);
  useEffect(() => { void load(); },[load]);
  async function enrich() {
    setBusy(true); setError('');
    try { setRun((await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enrich',ids:[id],osm:true})})).run); }
    catch (e) { setError(e instanceof Error ? e.message : 'Enrichissement indisponible.'); } finally { setBusy(false); }
  }
  const set = <K extends keyof SalesForm>(key:K,value:SalesForm[K]) => { setForm(old => old ? {...old,[key]:value} : old); setNotice(''); };
  const issues = form ? salesIssues({status:form.status,lost_reason:form.lost_reason,do_not_contact:form.do_not_contact,suppression_reason:form.suppression_reason}) : [];
  const dirty = Boolean(p && form && JSON.stringify(formOf(p)) !== JSON.stringify(form));

  async function save() {
    if (!form || issues.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/api/admin/platform/prospects/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        status:form.status, website_url:form.website_url.trim() || null,
        last_contact_at:toIso(form.last_contact_at), next_action_at:toIso(form.next_action_at),
        notes:form.notes.trim() || null, lost_reason:form.lost_reason.trim() || null,
        do_not_contact:form.do_not_contact, suppression_reason:form.suppression_reason.trim() || null,
        ...(form.append_note.trim() ? {append_note:form.append_note.trim()} : {}),
      })});
      setNotice(form.append_note.trim() ? 'Note ajoutée et fiche enregistrée.' : 'Fiche enregistrée.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible.'); } finally { setBusy(false); }
  }

  if (!p || !form) return <div className="mx-auto max-w-6xl space-y-5">
    <Link className={secondary} href="/admin/platform/prospects">← Prospects</Link>
    {error ? <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}<button className={secondary+' ml-3'} onClick={() => void load()}>Réessayer</button></div>
      : <p role="status" className="text-sm text-gray-500">Chargement…</p>}
  </div>;

  const assessment = assessProspect(p), links = contactLinks(p), closed = CLOSED_STATUSES.includes(form.status);
  return <div className="mx-auto max-w-6xl space-y-5 text-gray-950 dark:text-gray-100">
    <Link className={secondary} href="/admin/platform/prospects">← Prospects</Link>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-800">{notice}</p>}

    <header className="flex flex-wrap items-start justify-between gap-4"><div>
      <p className="text-xs font-semibold uppercase text-violet-600">Plateforme · Prospect</p>
      <h1 className="mt-1 text-2xl font-semibold">{p.business_name}</h1>
      <p className="mt-1 text-sm text-gray-500">{p.business_category ?? 'Catégorie non renseignée'} · {p.address ?? [p.postal_code,p.city].filter(Boolean).join(' ')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Badge value={p.status} /><FollowUp p={p} /><Fit p={p} /><Qualification p={p} />
        {p.do_not_contact && <span className="text-sm font-semibold text-red-700">Ne pas contacter</span>}</div>
      {links.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{links.map(link => <a key={link.key} href={link.href} className={secondary}
        {...(link.href.startsWith('http') ? {target:'_blank',rel:'noopener noreferrer'} : {})}>{link.label}</a>)}</div>}
    </div>
      <button className={secondary} disabled={busy || p.do_not_contact} onClick={() => void enrich()}>Actualiser les données</button>
    </header>
    {run && <RunPanel key={run.id} run={run} onChange={r => {setRun(r);if (['completed','partial','failed'].includes(r.status)) void load();}} />}

    <section className={card+' space-y-4'} aria-labelledby="sales-title"><h2 id="sales-title" className="font-semibold">Suivi commercial</h2>
      <form className="grid gap-4 lg:grid-cols-2" onSubmit={e => {e.preventDefault();void save();}}>
        <div className="space-y-3">
          <label className="block text-sm">Statut<select className={field} value={form.status} onChange={e => set('status',e.target.value as SalesStatus)}>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
          {form.status === 'lost' && <label className="block text-sm">Motif de perte (obligatoire)<input className={field} maxLength={1000} value={form.lost_reason} onChange={e => set('lost_reason',e.target.value)} placeholder="Ex. déjà équipé, pas de budget…" /></label>}
          <div className="text-sm">
            <label htmlFor="next-action">Prochaine action</label>
            <input id="next-action" className={field} type="datetime-local" disabled={closed} value={closed ? '' : form.next_action_at} onChange={e => set('next_action_at',e.target.value)} />
            {closed ? <p className="mt-1 text-xs text-gray-500">Aucune relance pour un prospect {STATUS_LABELS[form.status]?.toLowerCase()}.</p>
              : <div className="mt-2 flex flex-wrap gap-2">{([['Demain',1],['Dans 3 jours',3],['Dans 1 semaine',7]] as const).map(([label,days]) =>
                <button key={label} type="button" className={secondary} onClick={() => set('next_action_at',toLocal(presetFollowUp(days)))}>{label}</button>)}
                {form.next_action_at && <button type="button" className={secondary} onClick={() => set('next_action_at','')}>Aucune</button>}</div>}
          </div>
          <label className="block text-sm">Dernier contact<input className={field} type="datetime-local" value={form.last_contact_at} onChange={e => set('last_contact_at',e.target.value)} />
            <span className="mt-1 block text-xs text-gray-500">Rempli automatiquement en passant à « Contacté », « Réponse », « Démo » ou « Pilote ».</span></label>
        </div>
        <div className="space-y-3">
          <label className="block text-sm">Ajouter une note<textarea className={field} rows={3} maxLength={NOTE_MAX} value={form.append_note} onChange={e => set('append_note',e.target.value)} placeholder="Appel, réponse, objection, prochaine étape…" />
            <span className="mt-1 block text-xs text-gray-500">Datée automatiquement et ajoutée en haut de l’historique.</span></label>
          <div className="text-sm"><p className="text-gray-500">Historique</p>
            {p.notes ? <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-sans text-sm dark:bg-gray-800">{p.notes}</pre>
              : <p className="mt-1 text-gray-400">Aucune note.</p>}
            <details className="mt-2"><summary className="min-h-11 cursor-pointer text-xs text-gray-500">Corriger l’historique</summary>
              <textarea className={field} rows={6} maxLength={10000} value={form.notes} onChange={e => set('notes',e.target.value)} /></details>
          </div>
        </div>
        <div className="space-y-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700 lg:col-span-2">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={form.do_not_contact} onChange={e => set('do_not_contact',e.target.checked)} />
            Ne pas contacter (opposition) — exclut ce commerce des relances et des enrichissements</label>
          {form.do_not_contact && <label className="block text-sm">Motif de l’opposition (obligatoire)<input className={field} maxLength={1000} value={form.suppression_reason} onChange={e => set('suppression_reason',e.target.value)} placeholder="Ex. demande du gérant par téléphone le 05/10" /></label>}
          <details><summary className="min-h-11 cursor-pointer text-sm">Site professionnel (correction manuelle)</summary>
            <input className={field} type="url" maxLength={2048} value={form.website_url} onChange={e => set('website_url',e.target.value)} placeholder="https://…" />
            <p className="mt-1 text-xs text-gray-500">Changer le site efface les observations issues de l’ancien site ; relancez ensuite l’actualisation.</p></details>
        </div>
        {issues.length > 0 && <ul role="alert" className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800 lg:col-span-2">{issues.map(i => <li key={i}>{i}</li>)}</ul>}
        <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
          <button className={button} disabled={busy || !dirty || issues.length > 0}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          {dirty && <button type="button" className={secondary} disabled={busy} onClick={() => { setForm(formOf(p)); setNotice(''); }}>Annuler les modifications</button>}
        </div>
      </form>
    </section>

    <div className="grid gap-4 lg:grid-cols-2">
      <section className={card+' space-y-3 lg:col-span-2'}><h2 className="font-semibold">Pourquoi ce prospect</h2>
        <div className="grid gap-5 md:grid-cols-3">
          <div><h3 className="mb-2 text-sm font-medium">Observations</h3>{p.detected_problems.length ? <ul className="list-inside list-disc space-y-2 text-sm">{p.detected_problems.map(v => <li key={v}>{v}</li>)}</ul> : <p className="text-sm text-gray-500">Preuves insuffisantes : actualisez les données.</p>}</div>
          <div><h3 className="mb-2 text-sm font-medium">Modules Lepefy à proposer</h3>{p.recommended_modules.length ? <ul className="space-y-2 text-sm">{p.recommended_modules.map(v => <li key={v}>{v}</li>)}</ul> : <p className="text-sm text-gray-500">—</p>}</div>
          <div><h3 className="mb-2 text-sm font-medium">Détail du Fit Score</h3><ul className="space-y-1 text-sm">{p.score_breakdown.map(r => <li key={r.rule}>{r.rule} : +{r.points}</li>)}</ul><p className="mt-2 text-xs text-gray-500">Plafonné à 100.</p></div>
        </div>
        {p.qualification_reason && <p className="text-xs text-gray-500">{p.qualification_reason}</p>}
      </section>
      <section className={card+' space-y-3'}><h2 className="font-semibold">Présence digitale</h2>
        <p className="text-sm text-gray-500">« Non détecté » décrit uniquement les pages inspectées. Un accès bloqué reste non vérifiable.</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {([['has_ecommerce','Ecommerce'],['has_online_ordering','Commande en ligne'],['has_delivery','Livraison'],['has_whatsapp_ordering','Commande WhatsApp'],['has_events','Événements'],['has_catering','Traiteur'],['has_loyalty','Fidélité'],['has_multiple_locations','Plusieurs établissements']] as const).map(([key,label]) => <div key={key}><dt className="text-gray-500">{label}</dt><dd>{p[key] === true ? 'Détecté' : p[key] === false ? 'Non détecté' : 'Non vérifié'}</dd></div>)}
        </dl>
        <p className="text-sm">Maturité digitale : <strong>{QUALITY_LABELS[assessment.digital_maturity]}</strong> · Commande : <strong>{QUALITY_LABELS[assessment.ordering_maturity]}</strong></p>
        {p.website_title && <p className="text-sm">{p.website_title}</p>}{p.website_description && <p className="text-sm text-gray-500">{p.website_description}</p>}
      </section>
      <section className={card+' space-y-3'}><h2 className="font-semibold">Identité et contacts publics</h2>
        <p className="text-sm">{p.legal_name ?? p.business_name}<br />{p.address ?? 'Adresse non renseignée'}</p>
        <dl className="grid gap-3 text-sm">
          <div><dt className="text-gray-500">Site</dt><dd><ExternalLink href={p.website_url}>{p.website_url}</ExternalLink></dd></div>
          <div><dt className="text-gray-500">Téléphone professionnel</dt><dd>{p.phone ?? '—'}</dd></div>
          <div><dt className="text-gray-500">E-mail professionnel public</dt><dd>{p.public_email ?? '—'}</dd></div>
          {(['instagram_url','facebook_url','tiktok_url','whatsapp_url'] as const).map(key => <div key={key}><dt className="capitalize text-gray-500">{key.replace('_url','')}</dt><dd><ExternalLink href={p[key]}>{p[key]}</ExternalLink></dd></div>)}
        </dl>
      </section>
    </div>

    <details className={card}><summary className="min-h-11 cursor-pointer font-semibold">Diagnostic technique (sources, collecte, complétude)</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3"><Completeness p={p} /><span className="text-sm"><CollectionStatus p={p} /></span></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">{[
          ['Source',p.discovery_source],['SIRET',p.siret],['SIREN',p.siren],['APE',p.naf_ape_code],
          ['Découverte',dateLabel(p.discovered_at)],['Dernier enrichissement',dateLabel(p.last_enriched_at)],
          ['Dernier site complet',dateLabel(p.website_checked_at)],['Dernier OSM',dateLabel(p.osm_checked_at)],['Opposition',dateLabel(p.suppressed_at)],
        ].map(([k,v]) => <div key={k}><dt className="text-gray-500">{k}</dt><dd>{v || '—'}</dd></div>)}</dl>
        <p className="text-sm">Dernière analyse complète : <Badge value={p.crawl_status} /> HTTP {p.crawl_http_status ?? '—'} {p.crawl_error ?? ''}</p>
        <p className="text-sm">Technologies : {p.technologies.join(', ') || 'Non identifiées'}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-gray-500">Source du site</dt><dd>{p.evidence.find(e=>e.signal==='website_source')?.source ?? (p.website_url ? 'Source antérieure / saisie' : 'Non résolu')}</dd></div>
          <div><dt className="text-gray-500">Dernière tentative site</dt><dd>{PROVIDER_LABELS[collection(p,'website').status ?? ''] ?? 'Non commencée'} · {dateLabel(collection(p,'website').checked_at)} · HTTP {collection(p,'website').http_status ?? '—'} · {collection(p,'website').error ?? ''}</dd></div>
          <div><dt className="text-gray-500">OSM · dernière recherche</dt><dd>{PROVIDER_LABELS[collection(p,'osm').status ?? ''] ?? 'Non vérifié'} · {collection(p,'osm').confidence ?? (typeof p.osm_metadata.confidence==='number' ? p.osm_metadata.confidence : '—')}%<p>{(collection(p,'osm').reasons ?? []).join(' · ')}</p></dd></div>
          <div><dt className="text-gray-500"><span translate="no">Google Maps</span> · recherche facultative</dt><dd>{PROVIDER_LABELS[collection(p,'google').status ?? ''] ?? 'Non utilisé'} · {dateLabel(collection(p,'google').checked_at)}{collection(p,'google').place_id && <p>Place ID : {collection(p,'google').place_id}</p>}<p>{(collection(p,'google').reasons ?? []).join(' · ')}</p></dd></div>
        </dl>
        <details><summary className="min-h-11 cursor-pointer text-sm">Calcul de complétude : {assessment.data_completeness}%</summary>
          <ul className="space-y-1 text-sm">{assessment.completeness_breakdown.map(r=><li key={r.label}>{r.label} : {r.known ? r.points : 0}/{r.points}</li>)}</ul>
        </details>
        <details><summary className="min-h-11 cursor-pointer text-sm">Preuves et sources inspectées ({p.evidence.length})</summary><ul className="space-y-2 text-sm">{p.evidence.map((e,i) => <li key={i}>{e.signal} · {e.value} · <ExternalLink href={e.source}>Source</ExternalLink></li>)}</ul></details>
        {Object.keys(p.osm_metadata).length > 0 && <p className="text-xs text-gray-500">OpenStreetMap contributors · ODbL · {String(p.osm_metadata.id ?? p.osm_metadata.result ?? '')}</p>}
      </div>
    </details>
  </div>;
}
