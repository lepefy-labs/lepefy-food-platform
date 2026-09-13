'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CATEGORY_LABELS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_REACTIONS,
  FEEDBACK_STATUSES,
  PRIORITY_LABELS,
  REACTION_EMOJI,
  REACTION_LABELS,
  STATUS_LABELS,
} from '@/lib/feedback/contracts';

type Entry = {
  id: string; tenant_id: string; tenant_name: string; campaign_id: string;
  campaign: { id: string; name: string; version_label: string | null } | null;
  message: string; reaction: string | null; category: string | null; status: string; priority: string; created_at: string;
};
type Detail = Entry & {
  contact_allowed: boolean; contact_email: string | null; internal_note: string | null;
  context: Record<string, unknown>; updated_at: string;
};
type Campaign = {
  id: string; tenant_id: string; tenant_name: string; name: string; version_label: string | null;
  headline: string; intro: string | null; thank_you_message: string | null; active: boolean;
  feedback_count: number; created_at: string; closed_at: string | null;
};
type Tenant = { id: string; name: string };
type Listing = {
  entries: Entry[];
  pagination: { page: number; pageSize: number; total: number };
  kpis: { total: number; new: number; blocking: number; activeCampaigns: number; activeTenants: number };
};

const input = 'rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white';
const card = 'rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';
const button = 'rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50';
const secondary = 'rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Opération impossible.');
  return payload as T;
}

function shortDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}

export default function FeedbackAdminClient() {
  const [tab, setTab] = useState<'feedback' | 'campaigns'>('feedback');
  const [listing, setListing] = useState<Listing | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filters, setFilters] = useState({ tenant: '', campaign: '', status: '', priority: '', reaction: '', category: '' });
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  const loadCampaigns = useCallback(async () => {
    const data = await api<{ campaigns: Campaign[]; tenants: Tenant[] }>('/api/admin/platform/feedback/campaigns');
    setCampaigns(data.campaigns);
    setTenants(data.tenants);
  }, []);

  const loadEntries = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page) });
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    setListing(await api<Listing>('/api/admin/platform/feedback?' + query));
  }, [filters, page]);

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([loadEntries(), loadCampaigns()]).catch(reason => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')).finally(() => setLoading(false));
  }, [loadEntries, loadCampaigns]);

  async function openDetail(id: string) {
    setBusy(id); setError('');
    try {
      const data = await api<{ entry: Detail }>('/api/admin/platform/feedback/' + id);
      setDetail(data.entry);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Chargement impossible.'); }
    finally { setBusy(''); }
  }

  async function saveDetail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    setBusy(detail.id); setError('');
    try {
      await api('/api/admin/platform/feedback/' + detail.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: form.get('status'), priority: form.get('priority'), internalNote: String(form.get('internalNote') || '') || null }),
      });
      setDetail(null);
      await loadEntries();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.'); }
    finally { setBusy(''); }
  }

  async function saveCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const campaignForm = event.currentTarget;
    const form = new FormData(campaignForm);
    const payload = {
      tenantId: String(form.get('tenantId')),
      name: String(form.get('name')),
      versionLabel: String(form.get('versionLabel') || '') || null,
      headline: String(form.get('headline')),
      intro: String(form.get('intro') || '') || null,
      thankYouMessage: String(form.get('thankYouMessage') || '') || null,
      active: form.has('active'),
    };
    setBusy('campaign'); setError('');
    try {
      if (editingCampaign) {
        const patch = {
          name: payload.name,
          versionLabel: payload.versionLabel,
          headline: payload.headline,
          intro: payload.intro,
          thankYouMessage: payload.thankYouMessage,
          active: payload.active,
        };
        await api('/api/admin/platform/feedback/campaigns/' + editingCampaign.id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        });
      } else {
        await api('/api/admin/platform/feedback/campaigns', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      }
      setEditingCampaign(null);
      campaignForm.reset();
      await Promise.all([loadCampaigns(), loadEntries()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.'); }
    finally { setBusy(''); }
  }

  async function setCampaignActive(campaign: Campaign, active: boolean) {
    setBusy(campaign.id); setError('');
    try {
      await api('/api/admin/platform/feedback/campaigns/' + campaign.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
      });
      await Promise.all([loadCampaigns(), loadEntries()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Changement d’état impossible.'); }
    finally { setBusy(''); }
  }

  const pageCount = Math.max(1, Math.ceil((listing?.pagination.total ?? 0) / 25));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Plateforme</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">Feedback testeurs</h1>
          <p className="mt-1 text-sm text-gray-500">Piloter les campagnes et transformer les retours en actions.</p>
        </div>
        <Link href="/admin/platform" className={secondary}>Console Lepefy</Link>
      </header>

      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Total', listing?.kpis.total ?? 0], ['Nouveaux', listing?.kpis.new ?? 0],
          ['Bloquants', listing?.kpis.blocking ?? 0], ['Campagnes actives', listing?.kpis.activeCampaigns ?? 0],
          ['Tenants actifs', listing?.kpis.activeTenants ?? 0],
        ].map(([label, value]) => <div key={label} className={card + ' p-4'}><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <button type="button" onClick={() => setTab('feedback')} className={'px-4 py-3 text-sm font-semibold ' + (tab === 'feedback' ? 'border-b-2 border-violet-700 text-violet-700' : 'text-gray-500')}>Feedback</button>
        <button type="button" onClick={() => setTab('campaigns')} className={'px-4 py-3 text-sm font-semibold ' + (tab === 'campaigns' ? 'border-b-2 border-violet-700 text-violet-700' : 'text-gray-500')}>Campagnes</button>
      </div>

      {tab === 'feedback' ? (
        <>
          <section className={card + ' p-4'}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <select aria-label="Tenant" className={input} value={filters.tenant} onChange={event => { setFilters({ ...filters, tenant: event.target.value }); setPage(1); }}>
                <option value="">Tous les tenants</option>{tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select aria-label="Campagne" className={input} value={filters.campaign} onChange={event => { setFilters({ ...filters, campaign: event.target.value }); setPage(1); }}>
                <option value="">Toutes campagnes</option>{campaigns.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select aria-label="Statut" className={input} value={filters.status} onChange={event => { setFilters({ ...filters, status: event.target.value }); setPage(1); }}>
                <option value="">Tous statuts</option>{FEEDBACK_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
              </select>
              <select aria-label="Priorité" className={input} value={filters.priority} onChange={event => { setFilters({ ...filters, priority: event.target.value }); setPage(1); }}>
                <option value="">Toutes priorités</option>{FEEDBACK_PRIORITIES.map(value => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
              </select>
              <select aria-label="Réaction" className={input} value={filters.reaction} onChange={event => { setFilters({ ...filters, reaction: event.target.value }); setPage(1); }}>
                <option value="">Toutes réactions</option>{FEEDBACK_REACTIONS.map(value => <option key={value} value={value}>{REACTION_EMOJI[value]} {REACTION_LABELS[value]}</option>)}
              </select>
              <select aria-label="Catégorie" className={input} value={filters.category} onChange={event => { setFilters({ ...filters, category: event.target.value }); setPage(1); }}>
                <option value="">Toutes catégories</option>{FEEDBACK_CATEGORIES.map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}
              </select>
            </div>
          </section>

          <section className={card + ' overflow-hidden'}>
            {loading ? <p className="p-6 text-sm text-gray-500">Chargement…</p> : !listing?.entries.length ? <p className="p-6 text-sm text-gray-500">Aucun feedback pour ces filtres.</p> : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950"><tr><th className="p-3">Date</th><th className="p-3">Tenant / campagne</th><th className="p-3">Retour</th><th className="p-3">Statut</th><th className="p-3">Priorité</th><th className="p-3" /></tr></thead>
                    <tbody>{listing.entries.map(entry => <tr key={entry.id} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="whitespace-nowrap p-3 text-xs text-gray-500">{shortDate(entry.created_at)}</td>
                      <td className="p-3"><p className="font-medium">{entry.tenant_name}</p><p className="text-xs text-gray-500">{entry.campaign?.name ?? 'Campagne'}</p></td>
                      <td className="max-w-md p-3"><p className="line-clamp-2">{entry.reaction ? REACTION_EMOJI[entry.reaction as keyof typeof REACTION_EMOJI] + ' ' : ''}{entry.message}</p></td>
                      <td className="p-3">{STATUS_LABELS[entry.status as keyof typeof STATUS_LABELS] ?? entry.status}</td>
                      <td className="p-3">{PRIORITY_LABELS[entry.priority as keyof typeof PRIORITY_LABELS] ?? entry.priority}</td>
                      <td className="p-3"><button type="button" disabled={busy === entry.id} onClick={() => openDetail(entry.id)} className="font-semibold text-violet-700">Ouvrir</button></td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <div className="divide-y divide-gray-100 md:hidden">{listing.entries.map(entry => <button key={entry.id} type="button" onClick={() => openDetail(entry.id)} className="block w-full p-4 text-left">
                  <div className="flex justify-between gap-3"><p className="font-semibold">{entry.tenant_name}</p><span className="text-xs text-gray-500">{shortDate(entry.created_at)}</span></div>
                  <p className="mt-2 line-clamp-3 text-sm text-gray-700">{entry.message}</p>
                  <p className="mt-2 text-xs text-gray-500">{STATUS_LABELS[entry.status as keyof typeof STATUS_LABELS]} · {PRIORITY_LABELS[entry.priority as keyof typeof PRIORITY_LABELS]}</p>
                </button>)}</div>
              </>
            )}
          </section>
          <div className="flex items-center justify-between">
            <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className={secondary}>Précédent</button>
            <span className="text-sm text-gray-500">Page {page} / {pageCount}</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)} className={secondary}>Suivant</button>
          </div>
        </>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className={card + ' overflow-hidden'}>
            <div className="border-b border-gray-100 p-4"><h2 className="font-semibold">Campagnes</h2></div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {campaigns.map(campaign => <article key={campaign.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><div className="flex items-center gap-2"><h3 className="font-semibold">{campaign.name}</h3>{campaign.active ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">Active</span> : null}</div><p className="mt-1 text-xs text-gray-500">{campaign.tenant_name} · {campaign.version_label || 'Sans version'} · {campaign.feedback_count} retours</p><p className="mt-2 text-sm">{campaign.headline}</p></div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditingCampaign(campaign)} className={secondary}>Modifier</button>
                    <button type="button" disabled={busy === campaign.id} onClick={() => setCampaignActive(campaign, !campaign.active)} className={campaign.active ? secondary : button}>{campaign.active ? 'Clore' : 'Activer'}</button>
                  </div>
                </div>
              </article>)}
              {!campaigns.length ? <p className="p-5 text-sm text-gray-500">Aucune campagne.</p> : null}
            </div>
          </section>
          <form key={editingCampaign?.id ?? 'new'} onSubmit={saveCampaign} className={card + ' space-y-4 p-5'}>
            <div className="flex items-center justify-between"><h2 className="font-semibold">{editingCampaign ? 'Modifier la campagne' : 'Nouvelle campagne'}</h2>{editingCampaign ? <button type="button" className="text-sm text-gray-500" onClick={() => setEditingCampaign(null)}>Annuler</button> : null}</div>
            <label className="block text-sm font-medium">Tenant<select name="tenantId" required disabled={Boolean(editingCampaign)} defaultValue={editingCampaign?.tenant_id ?? ''} className={input + ' mt-1 w-full'}><option value="">Choisir…</option>{tenants.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block text-sm font-medium">Nom<input name="name" required maxLength={160} defaultValue={editingCampaign?.name ?? ''} className={input + ' mt-1 w-full'} /></label>
            <label className="block text-sm font-medium">Version<input name="versionLabel" maxLength={80} defaultValue={editingCampaign?.version_label ?? ''} className={input + ' mt-1 w-full'} placeholder="ex. beta-2" /></label>
            <label className="block text-sm font-medium">Titre public<input name="headline" required maxLength={240} defaultValue={editingCampaign?.headline ?? 'Aidez-nous à améliorer votre expérience'} className={input + ' mt-1 w-full'} /></label>
            <label className="block text-sm font-medium">Introduction<textarea name="intro" maxLength={2000} rows={3} defaultValue={editingCampaign?.intro ?? ''} className={input + ' mt-1 w-full'} /></label>
            <label className="block text-sm font-medium">Message de remerciement<textarea name="thankYouMessage" maxLength={1000} rows={3} defaultValue={editingCampaign?.thank_you_message ?? ''} className={input + ' mt-1 w-full'} /></label>
            <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked={editingCampaign?.active ?? false} /> Activer immédiatement</label>
            <button type="submit" disabled={busy === 'campaign'} className={button + ' w-full'}>{busy === 'campaign' ? 'Enregistrement…' : 'Enregistrer'}</button>
          </form>
        </div>
      )}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="feedback-detail-title">
          <form onSubmit={saveDetail} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="feedback-detail-title" className="text-xl font-semibold">Détail du feedback</h2><p className="mt-1 text-xs text-gray-500">{detail.tenant_name} · {detail.campaign?.name}</p></div><button type="button" onClick={() => setDetail(null)} className={secondary}>Fermer</button></div>
            <p className="mt-6 whitespace-pre-wrap rounded-2xl bg-gray-50 p-4 text-sm leading-6 dark:bg-gray-950">{detail.message}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-gray-500">Réaction</dt><dd>{detail.reaction ? REACTION_LABELS[detail.reaction as keyof typeof REACTION_LABELS] : '—'}</dd></div><div><dt className="text-gray-500">Catégorie</dt><dd>{detail.category ? CATEGORY_LABELS[detail.category as keyof typeof CATEGORY_LABELS] : '—'}</dd></div><div><dt className="text-gray-500">Contact autorisé</dt><dd>{detail.contact_allowed ? detail.contact_email : 'Non'}</dd></div><div><dt className="text-gray-500">Contexte sûr</dt><dd className="break-all text-xs">{JSON.stringify(detail.context)}</dd></div></dl>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Statut<select name="status" defaultValue={detail.status} className={input + ' mt-1 w-full'}>{FEEDBACK_STATUSES.map(value => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
              <label className="text-sm font-medium">Priorité<select name="priority" defaultValue={detail.priority} className={input + ' mt-1 w-full'}>{FEEDBACK_PRIORITIES.map(value => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}</select></label>
            </div>
            <label className="mt-4 block text-sm font-medium">Note interne<textarea name="internalNote" maxLength={4000} rows={5} defaultValue={detail.internal_note ?? ''} className={input + ' mt-1 w-full'} /></label>
            <button type="submit" disabled={busy === detail.id} className={button + ' mt-5 w-full'}>{busy === detail.id ? 'Enregistrement…' : 'Enregistrer les modifications'}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
