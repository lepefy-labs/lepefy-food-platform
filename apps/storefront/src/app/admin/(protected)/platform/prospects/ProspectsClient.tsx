'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CONFIG, FOOD_CODES, REGIONS, STATUS_LABELS } from '@/lib/platform/prospects/config';
import { STATUSES, type Prospect, type Run } from '@/lib/platform/prospects/types';
import { PIPELINE_STAGES } from '@/lib/platform/prospects/salesPipeline';
import { Fit, Completeness, Qualification, CollectionStatus, FollowUp } from './Quality';
import DiscoveryForm from './DiscoveryForm';
import RunPanel from './RunPanel';
import { api, Badge, button, card, dateLabel, ExternalLink, field, secondary } from './ui';

type Snapshot = {
  prospects:Prospect[];total:number;page:number;pageSize:number;counts:number[];runs:Run[];
  pipeline:Record<string,number>;followUp:{due:number;overdue:number};
  google:{enabled:boolean;limit:number;used:number | null;available:boolean};
};
type Tab = 'follow_up' | 'pipeline' | 'enrich' | 'all';

const TAB_QUERIES:Record<Tab,string> = {
  follow_up:'follow_up=due',
  pipeline:'status=qualified',
  enrich:'collection=unverified',
  all:'',
};

function tabOf(params:URLSearchParams):Tab {
  if (params.get('follow_up') === 'due') return 'follow_up';
  if (params.get('collection') === 'unverified') return 'enrich';
  const status = params.get('status');
  if (status && (PIPELINE_STAGES as readonly string[]).includes(status)) return 'pipeline';
  return 'all';
}

export default function ProspectsClient() {
  const router = useRouter(), pathname = usePathname(), searchParams = useSearchParams();
  // Filters live in the URL: they survive a reload, the back button and can be shared.
  const query = searchParams.toString() || TAB_QUERIES.follow_up;
  const params = new URLSearchParams(query), tab = tabOf(params);
  const [data,setData] = useState<Snapshot | null>(null), [selected,setSelected] = useState<string[]>([]);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [run,setRun] = useState<Run | null>(null);
  const setQuery = useCallback((next:string) => router.replace(next ? pathname+'?'+next : pathname+'?all=1', {scroll:false}), [router,pathname]);
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api<Snapshot>('/api/admin/platform/prospects?'+query); setData(result); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.'); } finally { setLoading(false); }
  },[query]);
  useEffect(() => { void load(); setSelected([]); },[load]);
  function changeRun(value:Run) {
    setRun(value); if (['completed','partial','failed'].includes(value.status)) void load();
  }
  async function enrich(unverified=false) {
    setBusy(true); setError('');
    try { changeRun((await api<{run:Run}>('/api/admin/platform/prospects',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'enrich',...(unverified ? {unverified:true} : {ids:selected}),osm:true})})).run); }
    catch (e) { setError(e instanceof Error ? e.message : 'Enrichissement indisponible.'); } finally { setBusy(false); }
  }
  const toggle = (id:string) => setSelected(old => old.includes(id) ? old.filter(x => x !== id) : old.length < CONFIG.enrichmentBatch ? [...old,id] : old);
  const page = (n:number) => { const p = new URLSearchParams(query); p.set('page',String(n)); setQuery(p.toString()); };
  const tabs:Array<[Tab,string,number | undefined]> = [
    ['follow_up','À relancer',data?.followUp.due],
    ['pipeline','Pipeline',undefined],
    ['enrich','À enrichir',data?.counts[1]],
    ['all','Tous',data?.counts[0]],
  ];

  return <div className="mx-auto max-w-7xl space-y-5 text-gray-950 dark:text-gray-100">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Plateforme</p>
      <h1 className="mt-1 text-2xl font-semibold">Prospects</h1><p className="mt-1 text-sm text-gray-500">Trouver les futurs clients Lepefy, les qualifier et suivre chaque contact.</p></div>
      <Link href="/admin/platform" className={secondary}>Console Lepefy</Link></header>

    <nav aria-label="Vues" className="flex flex-wrap gap-2">
      {tabs.map(([key,label,count]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} onClick={() => setQuery(TAB_QUERIES[key])}
        className={'inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold '+(tab === key ? 'bg-violet-600 text-white' : 'border border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800')}>
        {label}{typeof count === 'number' && <span className={'rounded-full px-2 text-xs '+(tab === key ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-800')}>{count}</span>}
        {key === 'follow_up' && (data?.followUp.overdue ?? 0) > 0 && <span className="rounded-full bg-red-100 px-2 text-xs text-red-800">{data?.followUp.overdue} en retard</span>}
      </button>)}
    </nav>

    {tab === 'pipeline' && <div className="flex flex-wrap gap-2" aria-label="Étapes du pipeline">
      {PIPELINE_STAGES.map((stage,index) => <button key={stage} type="button" onClick={() => setQuery('status='+stage)} aria-pressed={params.get('status') === stage}
        className={'inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm '+(params.get('status') === stage ? 'bg-violet-100 font-semibold text-violet-900' : 'bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200')}>
        {index > 0 && <span aria-hidden="true" className="text-gray-400">→</span>}{STATUS_LABELS[stage]} <strong>{data?.pipeline[stage] ?? '—'}</strong>
      </button>)}
    </div>}

    <details className={card} open={tab === 'enrich' || tab === 'all'}>
      <summary className="min-h-11 cursor-pointer font-semibold">Découverte et enrichissement</summary>
      <div className="mt-3 space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{(['Total','À enrichir','Qualifiés','Prioritaires'] as const).map((label,i) => <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800" key={label}><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-xl font-semibold">{data?.counts[i] ?? '—'}</p></div>)}</div>
        {data?.google.enabled && <p role="status" className="text-sm">Google Places : {data.google.available ? String(data.google.used)+' / '+data.google.limit+' requêtes réservées ce mois' : 'Quota indisponible — fournisseur suspendu'}{data.google.available && (data.google.used ?? 0)>=data.google.limit ? ' · Limite atteinte' : ''}</p>}
        <DiscoveryForm onRun={changeRun} />
        {data?.runs.length ? <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Traitements récents</summary>
          {data.runs.map(r => <button key={r.id} className="mt-2 flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm" onClick={() => setRun(r)}>
            <span>{r.kind === 'discovery' ? 'Découverte' : 'Enrichissement'} · {dateLabel(r.created_at)}</span><Badge value={r.status} /></button>)}</details> : null}
      </div>
    </details>
    {run && <RunPanel key={run.id} run={run} onChange={changeRun} />}

    <form key={query} className={card+' space-y-3'} onSubmit={e => {
      e.preventDefault(); const p = new URLSearchParams();
      new FormData(e.currentTarget).forEach((v,k) => { if (String(v)) p.set(k,String(v)); });
      setQuery(p.toString());
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm lg:col-span-2">Recherche<input name="q" className={field} placeholder="Commerce, ville, domaine, SIRET" maxLength={100} defaultValue={params.get('q') ?? ''} /></label>
        <label className="text-sm">Statut<select name="status" className={field} defaultValue={params.get('status') ?? ''}><option value="">Tous</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
        <label className="text-sm">Tri<select name="sort" className={field} defaultValue={params.get('sort') ?? (tab === 'follow_up' ? 'next_action' : 'collection')}>
          <option value="next_action">Prochaine action</option><option value="collection">Priorité de collecte</option><option value="fit">Fit Score décroissant</option></select></label>
      </div>
      {tab === 'follow_up' && <input type="hidden" name="follow_up" value="due" />}
      <details><summary className="min-h-11 cursor-pointer text-sm font-medium">Filtres avancés</summary>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Collecte<select name="collection" className={field} defaultValue={params.get('collection') ?? ''}><option value="">Tous</option><option value="unverified">À enrichir / actualiser</option><option value="enriched">Évaluation enrichie</option></select></label>
          <label className="text-sm">Score minimum<input name="score" className={field} type="number" min={0} max={100} defaultValue={params.get('score') ?? ''} /></label>
          <label className="text-sm">Qualification<select className={field} name="qualification_level" defaultValue={params.get('qualification_level') ?? ''}><option value="">Toutes</option>{['low','medium','high','priority'].map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
          <label className="text-sm">Pays<input className={field} name="country" placeholder="FR" maxLength={2} defaultValue={params.get('country') ?? ''} /></label>
          <label className="text-sm">Région<select className={field} name="region" defaultValue={params.get('region') ?? ''}><option value="">Toutes</option>{Object.entries(REGIONS).map(([c,n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="text-sm">Département<input className={field} name="department" maxLength={3} defaultValue={params.get('department') ?? ''} /></label>
          <label className="text-sm">Catégorie<select className={field} name="business_category" defaultValue={params.get('business_category') ?? ''}><option value="">Toutes</option>{Object.values(FOOD_CODES).map(c => <option key={c}>{c}</option>)}</select></label>
          {[['has_website','Site'],['has_ecommerce','Ecommerce'],['has_events','Événements'],['has_catering','Traiteur'],['has_whatsapp','WhatsApp']].map(([name,label]) => <label className="text-sm" key={name}>{label}<select className={field} name={name} defaultValue={params.get(name!) ?? ''}><option value="">Tous</option><option value="true">Détecté</option><option value="false">Non détecté</option></select></label>)}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="outbound" value="true" defaultChecked={params.get('outbound') === 'true'} />Candidats à contacter uniquement</label>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={loading}>Appliquer les filtres</button>
        <button type="button" className={secondary} onClick={() => setQuery(TAB_QUERIES[tab])}>Réinitialiser</button>
      </div>
    </form>

    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}<button className={secondary+' ml-3'} onClick={() => void load()}>Réessayer</button></div>}
    <section className={card+' space-y-4'} aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-3"><h2 className="mr-auto font-semibold">{data?.total ?? '—'} prospect{(data?.total ?? 0) > 1 ? 's' : ''}</h2>
        {tab !== 'follow_up' && <>
          <button className={secondary} disabled={busy || !selected.length} onClick={() => void enrich()}>Enrichir la sélection ({selected.length}/{CONFIG.enrichmentBatch})</button>
          <button className={button} disabled={busy} onClick={() => void enrich(true)}>Enrichir les non vérifiés (max. {CONFIG.enrichmentBatch})</button>
        </>}
      </div>
      {loading && <p role="status" className="text-sm text-gray-500">Chargement…</p>}
      {!loading && data?.prospects.length === 0 && <p className="py-8 text-center text-sm text-gray-500">
        {tab === 'follow_up' ? 'Aucune relance prévue aujourd’hui. Planifiez la prochaine action depuis la fiche d’un prospect du pipeline.' : 'Aucun prospect pour ces filtres. Lancez une découverte ou ajustez la recherche.'}
      </p>}
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-gray-700">
        <th className="px-2 py-3 font-medium"><span className="sr-only">Sélection</span></th>
        {['Commerce','Localisation','Statut','Prochaine action','Fit Score','Données','Qualification','Collecte'].map(c => <th className="px-2 py-3 font-medium" key={c}>{c}</th>)}</tr></thead>
        <tbody>{data?.prospects.map(p => <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800">
          <td className="px-2 py-3"><input aria-label={'Sélectionner '+p.business_name} type="checkbox" disabled={p.do_not_contact || (!selected.includes(p.id) && selected.length>=CONFIG.enrichmentBatch)} checked={selected.includes(p.id)} onChange={() => toggle(p.id)} /></td>
          <td className="min-w-40 px-2 py-3 font-medium"><Link className="text-violet-700 dark:text-violet-300" href={'/admin/platform/prospects/'+p.id}>{p.business_name}</Link>
            <p className="text-xs font-normal text-gray-500">{p.business_category ?? '—'}{p.domain ? ' · ' : ''}{p.domain && <ExternalLink href={p.website_url}>{p.domain}</ExternalLink>}</p>
            {p.do_not_contact && <p className="text-xs text-red-700">Ne pas contacter</p>}</td>
          <td className="px-2 py-3">{p.city ?? '—'}<p className="text-xs text-gray-500">{p.postal_code}</p></td>
          <td className="px-2 py-3"><Badge value={p.status} /></td>
          <td className="px-2 py-3"><FollowUp p={p} /></td>
          <td className="px-2 py-3"><Fit p={p} /></td><td className="px-2 py-3"><Completeness p={p} /></td><td className="px-2 py-3"><Qualification p={p} /></td>
          <td className="px-2 py-3 text-xs"><CollectionStatus p={p} /><p className="text-gray-500">{dateLabel(p.last_enriched_at)}</p></td>
        </tr>)}</tbody></table></div>
      <div className="space-y-3 md:hidden">{data?.prospects.map(p => <article className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-700" key={p.id}>
        <div className="flex items-center gap-3"><input type="checkbox" aria-label={'Sélectionner '+p.business_name} checked={selected.includes(p.id)} disabled={p.do_not_contact || (!selected.includes(p.id) && selected.length>=CONFIG.enrichmentBatch)} onChange={() => toggle(p.id)} /><Link className="font-semibold text-violet-700 dark:text-violet-300" href={'/admin/platform/prospects/'+p.id}>{p.business_name}</Link></div>
        <p className="text-sm">{p.business_category} · {p.city}</p>
        <div className="flex flex-wrap items-center gap-3"><Badge value={p.status} /><FollowUp p={p} /><Fit p={p} /><Qualification p={p} /></div>
        {p.do_not_contact && <p className="text-sm text-red-700">Ne pas contacter</p>}
      </article>)}</div>
      {data && <div className="flex items-center justify-between gap-3"><button className={secondary} disabled={loading || data.page<=1} onClick={() => page(data.page-1)}>Précédent</button>
        <span className="text-sm">Page {data.page} / {Math.max(1,Math.ceil(data.total/data.pageSize))}</span><button className={secondary} disabled={loading || data.page*data.pageSize>=data.total} onClick={() => page(data.page+1)}>Suivant</button></div>}
    </section>
  </div>;
}
