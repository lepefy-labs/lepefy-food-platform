'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { IconDownload, IconExternalLink, IconEye, IconEyeOff, IconRefresh, IconSearch } from '@tabler/icons-react';

interface Delivery {
  id: string;
  notification_type: string;
  subject: string | null;
  recipients: string[];
  status: 'pending' | 'processing' | 'accepted' | 'failed' | 'dead';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  accepted_at: string | null;
  retryable: boolean;
  transport?: 'n8n' | 'brevo' | null;
  provider_message_id?: string | null;
}

const STATUS: Record<Delivery['status'], { label: string; cls: string }> = {
  accepted: { label: 'Envoyé', cls: 'bg-tone-success-bg text-tone-success-fg ring-tone-success-border' },
  processing: { label: 'En cours', cls: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border' },
  pending: { label: 'En attente', cls: 'bg-tone-info-bg text-tone-info-fg ring-tone-info-border' },
  failed: { label: 'Nouvel essai prévu', cls: 'bg-tone-warning-bg text-tone-warning-fg ring-tone-warning-border' },
  dead: { label: 'Échec définitif', cls: 'bg-tone-danger-bg text-tone-danger-fg ring-tone-danger-border' },
};

const TYPES: Record<string, string> = {
  order_confirmed: 'Commande confirmée', order_shipped: 'Commande expédiée', order_ready_for_pickup: 'Prête au retrait',
  order_completed: 'Commande terminée', order_cancelled: 'Commande annulée', order_stock_conflict: 'Conflit de stock',
  payment_reminder: 'Relance paiement', card_quick_payment: 'Paiement carte', card_quick_payment_customer: 'Paiement carte (client)', event_reservation_confirmed: 'Réservation événement',
  event_capacity_conflict: 'Événement complet', rental_stock_conflict: 'Matériel indisponible',
  service_inquiry_created: 'Demande de devis', rental_reservation_confirmed_customer: 'Réservation matériel (client)',
  rental_reservation_confirmed_admin: 'Réservation matériel (équipe)', rental_delivery_quote_pending: 'Livraison à chiffrer',
  external_payment_awaiting_verification: 'Paiement externe à vérifier', event_external_payment_awaiting_verification: 'Réservation à vérifier',
  review_invite: 'Invitation avis', tester_feedback_invite: 'Invitation testeur', event_booking_closed_reports: 'Rapports de clôture',
  marketing_campaign: 'Campagne marketing', daily_order_digest: 'Rapport quotidien (08h)',
};

type StatusFilter = 'all' | 'accepted' | 'problems' | 'in_progress';
const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Tous les statuts' },
  { value: 'accepted', label: 'Envoyés' },
  { value: 'problems', label: 'Échecs et nouveaux essais' },
  { value: 'in_progress', label: 'En cours' },
];

/** Brevo transactional logs, searchable by message id or recipient. */
const BREVO_LOGS_URL = 'https://app.brevo.com/transactional/email/logs';
const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const INPUT_CLS = 'h-10 rounded-lg border border-a-border bg-a-surface px-3 text-sm text-a-text shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-a-focus';

function statusOf(d: Delivery) {
  // Logged-only deliveries (no retry payload) are retried by their own module.
  if (d.status === 'dead' && !d.retryable && d.max_attempts <= 1) return { label: 'Échec', cls: STATUS.dead.cls };
  return STATUS[d.status];
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function NotificationDeliveriesSection() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 7 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, limit: '500' });
      const res = await fetch(`/api/admin/platform/notification-deliveries?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json() as { available: boolean; deliveries: Delivery[] };
      setAvailable(body.available); setDeliveries(body.deliveries);
    } catch { setMessage({ text: 'Historique indisponible.', ok: false }); } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  async function retry(id: string) {
    setRetrying(id); setMessage(null);
    try {
      const res = await fetch(`/api/admin/platform/notification-deliveries/${id}/retry`, { method: 'POST' });
      const body = await res.json().catch(() => null) as { accepted?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Erreur');
      setMessage(body?.accepted
        ? { text: 'Envoi accepté.', ok: true }
        : { text: `Nouvel échec${body?.error ? ` : ${body.error}` : ''}. Un autre essai est programmé.`, ok: false });
      await load();
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Erreur', ok: false }); } finally { setRetrying(null); }
  }

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (statusFilter === 'accepted' && d.status !== 'accepted') return false;
      if (statusFilter === 'problems' && d.status !== 'failed' && d.status !== 'dead') return false;
      if (statusFilter === 'in_progress' && d.status !== 'processing' && d.status !== 'pending') return false;
      if (!needle) return true;
      return [d.subject, d.notification_type, TYPES[d.notification_type], d.last_error, d.provider_message_id, ...d.recipients]
        .some((value) => value?.toLowerCase().includes(needle));
    });
  }, [deliveries, search, statusFilter]);

  function downloadCsv() {
    const header = ['date', 'statut', 'type', 'objet', 'destinataires', 'essais', 'transport', 'id_message', 'erreur'];
    const lines = visible.map((d) => [
      d.created_at, statusOf(d).label, TYPES[d.notification_type] ?? d.notification_type, d.subject, d.recipients.join(' '),
      `${d.attempts}/${d.max_attempts}`, d.transport, d.provider_message_id, d.last_error,
    ].map(csvCell).join(';'));
    const blob = new Blob([`﻿${[header.join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `envois-${from}-${to}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-a-text">Historique des envois</h2>
          <p className="mt-1 text-sm text-a-text-3">Tous les emails automatiques du tenant, avec transport, identifiants et erreurs techniques. Réservé au support plateforme.</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 text-sm font-semibold text-a-brand-fg hover:opacity-80 disabled:opacity-50"><IconRefresh size={17} />Actualiser</button>
          <button onClick={downloadCsv} disabled={!visible.length} className="inline-flex items-center gap-1.5 text-sm font-semibold text-a-brand-fg hover:opacity-80 disabled:opacity-50"><IconDownload size={17} />Télécharger CSV</button>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 lg:flex-row">
        <div className="flex flex-1 overflow-hidden rounded-lg border border-a-border shadow-sm">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="h-10 border-r border-a-border bg-a-surface-2 px-3 text-sm text-a-text outline-none" aria-label="Filtrer par statut">
            {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label className="flex flex-1 items-center gap-2 bg-a-surface px-3">
            <IconSearch size={16} className="text-a-text-3" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Destinataire, objet, type, erreur, ID…" className="h-10 w-full bg-transparent text-sm text-a-text outline-none placeholder:text-a-text-3" />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLS} aria-label="Du" />
          <span className="text-a-text-3">–</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={INPUT_CLS} aria-label="Au" />
        </div>
      </div>

      {message && <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</div>}

      {!available ? (
        <p className="mt-5 rounded-xl border border-dashed border-a-border p-6 text-center text-sm text-a-text-3">Historique disponible après la migration 136.</p>
      ) : (
        <>
          <p className="mt-5 text-base font-semibold text-a-text">
            {loading && !deliveries.length ? 'Chargement…' : `${visible.length} envoi${visible.length > 1 ? 's' : ''}`}
            {deliveries.length >= 500 && <span className="ml-2 text-xs font-normal text-a-text-3">(500 plus récents de la période)</span>}
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-a-border">
            <table className="w-full min-w-[920px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-a-border bg-a-surface-2 text-left text-[13px] font-semibold text-a-text-2">
                  <th className="w-12 px-4 py-3" aria-label="Détails" />
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Objet</th>
                  <th className="px-4 py-3">Destinataire</th>
                  <th className="px-4 py-3 text-center">Essais</th>
                  <th className="px-4 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {!loading && visible.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-a-text-3">Aucun envoi pour ces critères.</td></tr>
                )}
                {visible.map((d) => {
                  const open = expanded === d.id;
                  const status = statusOf(d);
                  return (
                    <Fragment key={d.id}>
                      <tr className={`border-b border-a-border transition hover:bg-a-surface-2 ${open ? 'bg-a-surface-2' : ''}`}>
                        <td className="px-4 py-3">
                          <button onClick={() => setExpanded(open ? null : d.id)} className="text-a-brand-fg hover:opacity-70" aria-label={open ? 'Masquer les détails' : 'Afficher les détails'} aria-expanded={open}>
                            {open ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                          </button>
                        </td>
                        <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${status.cls}`}>{status.label}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-a-text-2">{dateFmt.format(new Date(d.created_at))}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-a-text-2">{TYPES[d.notification_type] ?? d.notification_type}</td>
                        <td className="max-w-[280px] truncate px-4 py-3 text-a-text" title={d.subject ?? ''}>{d.subject ?? '—'}</td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-a-text-2" title={d.recipients.join(', ')}>
                          {d.recipients[0] ?? '—'}{d.recipients.length > 1 && <span className="ml-1 text-xs text-a-text-3">+{d.recipients.length - 1}</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-a-text-2">{d.attempts}/{d.max_attempts}</td>
                        <td className="px-4 py-3 text-right">
                          {(d.status === 'failed' || d.status === 'dead') && d.retryable && (
                            <button onClick={() => void retry(d.id)} disabled={retrying === d.id} className="whitespace-nowrap rounded-lg border border-a-border px-2.5 py-1.5 text-xs font-medium text-a-text-2 hover:bg-a-surface disabled:opacity-50">{retrying === d.id ? 'Envoi…' : 'Réessayer'}</button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-a-border bg-a-surface-2">
                          <td />
                          <td colSpan={7} className="px-4 pb-4 pt-1">
                            <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                              <div><dt className="text-a-text-3">Objet</dt><dd className="break-words text-a-text">{d.subject ?? '—'}</dd></div>
                              <div><dt className="text-a-text-3">Destinataires</dt><dd className="break-words text-a-text">{d.recipients.join(', ') || '—'}</dd></div>
                              <div><dt className="text-a-text-3">Transport</dt><dd className="text-a-text">{d.transport === 'brevo' ? 'Brevo API' : d.transport === 'n8n' ? 'n8n' : '—'}</dd></div>
                              <div>
                                <dt className="text-a-text-3">ID message</dt>
                                <dd className="flex flex-wrap items-center gap-2 text-a-text">
                                  <span className="select-all break-all font-mono">{d.provider_message_id ?? '—'}</span>
                                  {d.provider_message_id && <a href={BREVO_LOGS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-a-brand-fg hover:underline">Logs Brevo <IconExternalLink size={13} /></a>}
                                </dd>
                              </div>
                              <div><dt className="text-a-text-3">Accepté le</dt><dd className="text-a-text">{d.accepted_at ? dateFmt.format(new Date(d.accepted_at)) : '—'}</dd></div>
                              {d.status === 'failed' && <div><dt className="text-a-text-3">Prochain essai</dt><dd className="text-tone-warning-fg">{dateFmt.format(new Date(d.next_attempt_at))}</dd></div>}
                              {d.last_error && d.status !== 'accepted' && (
                                <div className="sm:col-span-2"><dt className="text-a-text-3">Erreur</dt><dd className="break-words font-mono text-tone-danger-fg">{d.last_error}</dd></div>
                              )}
                              {!d.retryable && d.status !== 'accepted' && (
                                <div className="sm:col-span-2 text-a-text-3">Envoi journalisé uniquement : les nouveaux essais sont gérés par le module d’origine.</div>
                              )}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
