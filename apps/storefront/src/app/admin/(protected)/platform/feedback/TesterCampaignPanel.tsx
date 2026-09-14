'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type Campaign = { id: string; name: string; google_play_test_url: string | null };
type InstallationStatus = 'unknown' | 'installed' | 'problem';
type InstallationFilter = 'all' | InstallationStatus;
type Tester = {
  id: string;
  email: string;
  phone: string | null;
  installation_status: InstallationStatus;
  delivery_status: string;
  sent_at: string | null;
  delivery_failed_at: string | null;
  activated_at: string | null;
  revoked_at: string | null;
  last_feedback_at: string | null;
  created_at: string;
  feedback_count: number;
};

const input = 'rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white';
const button = 'rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Opération impossible.');
  return payload as T;
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}

function status(tester: Tester) {
  if (tester.revoked_at) return 'Révoquée';
  if (tester.delivery_status === 'activated') return 'Envoyée';
  if (tester.delivery_status === 'delivery_failed') return 'Échec envoi';
  if (tester.delivery_status === 'sent') return 'Envoyée';
  return 'En attente';
}

function installationLabel(value: InstallationStatus) {
  if (value === 'installed') return 'Installée';
  if (value === 'problem') return 'Problème';
  return 'À confirmer';
}

function installationBadgeClass(value: InstallationStatus) {
  if (value === 'installed') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
  if (value === 'problem') return 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300';
  return 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300';
}

function installationRowClass(value: InstallationStatus) {
  if (value === 'problem') return 'bg-red-50/80 dark:bg-red-950/20';
  if (value === 'unknown') return 'bg-amber-50/80 dark:bg-amber-950/20';
  return '';
}

export default function TesterCampaignPanel({ campaign, onRefresh }: { campaign: Campaign; onRefresh: () => Promise<void> }) {
  const [testers, setTesters] = useState<Tester[]>([]);
  const [emails, setEmails] = useState('');
  const [installationFilter, setInstallationFilter] = useState<InstallationFilter>('all');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const base = `/api/admin/platform/feedback/campaigns/${campaign.id}/testers`;
  const load = useCallback(async () => {
    const data = await api<{ testers: Tester[] }>(base);
    setTesters(data.testers);
  }, [base]);

  useEffect(() => {
    setError('');
    setMessage('');
    load().catch(reason => setError(reason instanceof Error ? reason.message : 'Chargement impossible.'));
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const normalized = [...new Set(emails.split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
    if (!normalized.length) return;
    setBusy('add');
    setError('');
    setMessage('');
    try {
      const result = await api<{ added: number; skipped: number }>(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: normalized }),
      });
      setEmails('');
      setMessage(`${result.added} testeur(s) ajouté(s)${result.skipped ? `, ${result.skipped} déjà présent(s)` : ''}.`);
      await Promise.all([load(), onRefresh()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ajout impossible.');
    } finally {
      setBusy('');
    }
  }

  async function send(id: string) {
    setBusy(id);
    setError('');
    setMessage('');
    try {
      await api(`${base}/${id}/send`, { method: 'POST' });
      setMessage('Invitation acceptée par le workflow e-mail.');
      await Promise.all([load(), onRefresh()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible.');
      await load();
    } finally {
      setBusy('');
    }
  }

  async function sendPending() {
    setBusy('bulk');
    setError('');
    setMessage('');
    try {
      const result = await api<{ sent: number; failed: number }>(`${base}/send-pending`, { method: 'POST' });
      setMessage(`${result.sent} invitation(s) acceptée(s), ${result.failed} échec(s).`);
      await Promise.all([load(), onRefresh()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible.');
    } finally {
      setBusy('');
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Révoquer cette invitation ? Le lien et la session active seront invalidés. Les feedback existants seront conservés.')) return;
    setBusy(id);
    setError('');
    setMessage('');
    try {
      await api(`${base}/${id}/revoke`, { method: 'POST' });
      setMessage('Invitation révoquée.');
      await Promise.all([load(), onRefresh()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Révocation impossible.');
    } finally {
      setBusy('');
    }
  }

  const canSend = Boolean(campaign.google_play_test_url);
  const pending = testers.some(tester => !tester.revoked_at && !tester.activated_at && ['pending', 'delivery_failed'].includes(tester.delivery_status));
  const installationCounts = useMemo(() => ({
    all: testers.length,
    installed: testers.filter(tester => tester.installation_status === 'installed').length,
    unknown: testers.filter(tester => tester.installation_status === 'unknown').length,
    problem: testers.filter(tester => tester.installation_status === 'problem').length,
  }), [testers]);
  const visibleTesters = useMemo(
    () => installationFilter === 'all' ? testers : testers.filter(tester => tester.installation_status === installationFilter),
    [installationFilter, testers],
  );
  const filters: Array<{ value: InstallationFilter; label: string; count: number }> = [
    { value: 'all', label: 'Tous', count: installationCounts.all },
    { value: 'installed', label: 'Installée', count: installationCounts.installed },
    { value: 'unknown', label: 'À confirmer', count: installationCounts.unknown },
    { value: 'problem', label: 'Problème', count: installationCounts.problem },
  ];

  return <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-5 dark:border-gray-800">
      <div>
        <h2 className="font-semibold">Testeurs · {campaign.name}</h2>
        <p className="mt-1 text-xs text-gray-500">Activation Lepefy — le nombre officiel de testeurs reste celui de Google Play.</p>
      </div>
      <button type="button" className={button} disabled={!canSend || !pending || busy === 'bulk'} aria-describedby={!canSend ? 'missing-play-url' : undefined} onClick={sendPending}>Envoyer les invitations en attente</button>
    </div>
    {!canSend ? <p id="missing-play-url" className="mx-5 mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Ajoutez une URL du test Google Play à la campagne avant tout envoi.</p> : null}
    {error ? <p role="alert" className="mx-5 mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {message ? <p role="status" className="mx-5 mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p> : null}
    <form onSubmit={add} className="grid gap-3 border-b border-gray-100 p-5 dark:border-gray-800 sm:grid-cols-[1fr_auto] sm:items-end">
      <label className="text-sm font-medium">Ajouter des testeurs<textarea value={emails} onChange={event => setEmails(event.target.value)} rows={4} required className={input + ' mt-2 w-full'} placeholder={'mario@gmail.com\nanna@gmail.com; luc@gmail.com'} /><span className="mt-1 block text-xs font-normal text-gray-500">Une ou plusieurs adresses, séparées par ligne, virgule ou point-virgule.</span></label>
      <button type="submit" disabled={busy === 'add'} className={button}>Ajouter</button>
    </form>
    <div className="flex flex-wrap gap-2 border-b border-gray-100 p-4 dark:border-gray-800" aria-label="Filtrer par statut d’installation">
      {filters.map(filter => <button
        key={filter.value}
        type="button"
        aria-pressed={installationFilter === filter.value}
        onClick={() => setInstallationFilter(filter.value)}
        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${installationFilter === filter.value ? 'border-violet-700 bg-violet-700 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'}`}
      >{filter.label} <span className="ml-1 opacity-80">{filter.count}</span></button>)}
    </div>
    <div className="hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-950"><tr><th className="p-3">Testeur</th><th className="p-3">Invitation</th><th className="p-3">Activation</th><th className="p-3">Installation</th><th className="p-3">Feedback</th><th className="p-3">Dernière activité</th><th className="p-3">Actions</th></tr></thead><tbody>
      {visibleTesters.map(tester => <tr key={tester.id} className={`border-t border-gray-100 dark:border-gray-800 ${installationRowClass(tester.installation_status)}`}><td className="p-3"><p className="font-medium">{tester.email}</p>{tester.phone ? <a className="mt-1 inline-block text-xs text-violet-700 hover:underline dark:text-violet-300" href={`tel:${tester.phone}`}>{tester.phone}</a> : <p className="mt-1 text-xs text-gray-400">Téléphone non renseigné</p>}</td><td className="p-3">{status(tester)}</td><td className="p-3">{tester.activated_at ? '✓ Activé' : tester.revoked_at ? 'Révoqué' : 'En attente'}</td><td className="p-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${installationBadgeClass(tester.installation_status)}`}>{installationLabel(tester.installation_status)}</span></td><td className="p-3">{tester.feedback_count}</td><td className="p-3 text-xs text-gray-500">{date(tester.last_feedback_at ?? tester.activated_at ?? tester.sent_at ?? tester.created_at)}</td><td className="p-3"><div className="flex flex-wrap gap-2">{!tester.revoked_at && !tester.activated_at ? <button type="button" className={secondary} disabled={!canSend || busy === tester.id} onClick={() => send(tester.id)}>{tester.delivery_status === 'pending' ? 'Envoyer' : tester.delivery_status === 'delivery_failed' ? 'Réessayer' : 'Renvoyer'}</button> : null}{!tester.revoked_at ? <button type="button" className={secondary} disabled={busy === tester.id} onClick={() => revoke(tester.id)}>Révoquer</button> : null}</div></td></tr>)}
    </tbody></table></div>
    <div className="divide-y divide-gray-100 md:hidden">{visibleTesters.map(tester => <article key={tester.id} className={`space-y-3 p-4 ${installationRowClass(tester.installation_status)}`}><div><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="break-all font-semibold">{tester.email}</p>{tester.phone ? <a className="mt-1 inline-block text-xs text-violet-700 hover:underline dark:text-violet-300" href={`tel:${tester.phone}`}>{tester.phone}</a> : <p className="mt-1 text-xs text-gray-400">Téléphone non renseigné</p>}</div><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${installationBadgeClass(tester.installation_status)}`}>{installationLabel(tester.installation_status)}</span></div><p className="mt-2 text-xs text-gray-500">{status(tester)} · {tester.activated_at ? '✓ Activé' : tester.revoked_at ? 'Révoqué' : 'En attente'} · {tester.feedback_count} feedback</p><p className="mt-1 text-xs text-gray-500">Dernière activité : {date(tester.last_feedback_at ?? tester.activated_at ?? tester.sent_at ?? tester.created_at)}</p></div><div className="flex flex-wrap gap-2">{!tester.revoked_at && !tester.activated_at ? <button type="button" className={secondary} disabled={!canSend || busy === tester.id} onClick={() => send(tester.id)}>{tester.delivery_status === 'pending' ? 'Envoyer' : tester.delivery_status === 'delivery_failed' ? 'Réessayer' : 'Renvoyer'}</button> : null}{!tester.revoked_at ? <button type="button" className={secondary} disabled={busy === tester.id} onClick={() => revoke(tester.id)}>Révoquer</button> : null}</div></article>)}</div>
    {!testers.length ? <p className="p-5 text-sm text-gray-500">Aucun testeur ajouté.</p> : null}
    {testers.length && !visibleTesters.length ? <p className="p-5 text-sm text-gray-500">Aucun testeur dans ce filtre.</p> : null}
  </section>;
}
