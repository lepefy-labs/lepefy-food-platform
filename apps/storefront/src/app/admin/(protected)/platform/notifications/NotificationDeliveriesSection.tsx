'use client';

import { useCallback, useEffect, useState } from 'react';
import { IconMailForward, IconRefresh } from '@tabler/icons-react';

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
  retryable: boolean;
  transport?: 'n8n' | 'brevo' | null;
  provider_message_id?: string | null;
}

const STATUS: Record<Delivery['status'], { label: string; cls: string }> = {
  accepted: { label: 'Envoyé', cls: 'bg-green-50 text-green-700' },
  processing: { label: 'En cours', cls: 'bg-sky-50 text-sky-700' },
  pending: { label: 'En attente', cls: 'bg-sky-50 text-sky-700' },
  failed: { label: 'Nouvel essai prévu', cls: 'bg-amber-50 text-amber-700' },
  dead: { label: 'Échec définitif', cls: 'bg-red-50 text-red-700' },
};

const TYPES: Record<string, string> = {
  order_confirmed: 'Commande confirmée', order_shipped: 'Commande expédiée', order_ready_for_pickup: 'Prête au retrait',
  order_completed: 'Commande terminée', order_cancelled: 'Commande annulée', order_stock_conflict: 'Conflit de stock',
  payment_reminder: 'Relance paiement', card_quick_payment: 'Paiement carte', event_reservation_confirmed: 'Réservation événement',
  event_capacity_conflict: 'Événement complet', rental_stock_conflict: 'Matériel indisponible',
  service_inquiry_created: 'Demande de devis', rental_reservation_confirmed_customer: 'Réservation matériel (client)',
  rental_reservation_confirmed_admin: 'Réservation matériel (équipe)', rental_delivery_quote_pending: 'Livraison à chiffrer',
  external_payment_awaiting_verification: 'Paiement externe à vérifier', event_external_payment_awaiting_verification: 'Réservation à vérifier',
  review_invite: 'Invitation avis', tester_feedback_invite: 'Invitation testeur', event_booking_closed_reports: 'Rapports de clôture',
  marketing_campaign: 'Campagne marketing', daily_order_digest: 'Rapport quotidien (08h)',
};

/** Brevo transactional logs, searchable by message id or recipient. */
const BREVO_LOGS_URL = 'https://app.brevo.com/transactional/email/logs';

function statusOf(d: Delivery) {
  // Logged-only deliveries (no retry payload) are retried by their own module.
  if (d.status === 'dead' && !d.retryable && d.max_attempts <= 1) return { label: 'Échec', cls: STATUS.dead.cls };
  return STATUS[d.status];
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function NotificationDeliveriesSection() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [available, setAvailable] = useState(true);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/platform/notification-deliveries', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const body = await res.json() as { available: boolean; deliveries: Delivery[] };
      setAvailable(body.available); setDeliveries(body.deliveries);
    } catch { setMessage({ text: 'Historique indisponible.', ok: false }); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function retry(id: string) {
    setRetrying(id); setMessage(null);
    try {
      const res = await fetch(`/api/admin/platform/notification-deliveries/${id}/retry`, { method: 'POST' });
      const body = await res.json().catch(() => null) as { accepted?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Erreur');
      setMessage(body?.accepted ? { text: 'Envoi accepté.', ok: true } : { text: 'Nouvel échec : un autre essai est programmé.', ok: false });
      await load();
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Erreur', ok: false }); } finally { setRetrying(null); }
  }

  const visible = onlyFailures ? deliveries.filter((d) => d.status === 'failed' || d.status === 'dead') : deliveries;

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-3 border-b border-sky-100 bg-sky-50/80 px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-sky-600 shadow-sm dark:bg-gray-800 dark:text-sky-300"><IconMailForward size={19} stroke={1.7} /></div>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-sky-700 dark:text-sky-200">Historique des envois</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Support plateforme · 50 derniers emails automatiques du tenant, avec transport, identifiants et erreurs techniques (non visibles par le tenant)</p></div>
        <button onClick={() => void load()} disabled={loading} className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700" aria-label="Actualiser"><IconRefresh size={15} /></button>
      </header>
      <div className="p-4 sm:p-5">
        {message && <div className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</div>}
        {!available ? (
          <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/30 p-4 text-sm text-gray-500">Historique disponible après la migration 136.</p>
        ) : (
          <>
            <label className="mb-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={onlyFailures} onChange={(e) => setOnlyFailures(e.target.checked)} />Afficher uniquement les échecs</label>
            {loading && deliveries.length === 0 && <p className="text-sm text-gray-500">Chargement…</p>}
            {!loading && visible.length === 0 && <p className="rounded-xl border border-dashed border-sky-200 bg-sky-50/30 p-4 text-sm text-gray-500">Aucun envoi à afficher.</p>}
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {visible.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{d.subject ?? TYPES[d.notification_type] ?? d.notification_type}</p>
                    <p className="truncate text-xs text-gray-500">{TYPES[d.notification_type] ?? d.notification_type} · {dateFmt.format(new Date(d.created_at))}{d.recipients.length ? ` · ${d.recipients.join(', ')}` : ''}</p>
                    {d.last_error && d.status !== 'accepted' && <p className="mt-1 break-words text-xs text-red-600">{d.last_error}</p>}
                    {(d.transport || d.provider_message_id) && (
                      <p className="mt-1 truncate text-[11px] text-gray-400">
                        {d.transport === 'brevo' ? 'Brevo' : d.transport === 'n8n' ? 'n8n' : ''}
                        {d.provider_message_id && <> · ID <span className="select-all font-mono">{d.provider_message_id}</span> · <a href={BREVO_LOGS_URL} target="_blank" rel="noreferrer" className="underline">logs Brevo</a></>}
                      </p>
                    )}
                    {d.status === 'failed' && <p className="mt-1 text-xs text-amber-700">Essai {d.attempts}/{d.max_attempts} · prochain essai {dateFmt.format(new Date(d.next_attempt_at))}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${statusOf(d).cls}`}>{statusOf(d).label}</span>
                    {(d.status === 'failed' || d.status === 'dead') && d.retryable && (
                      <button onClick={() => void retry(d.id)} disabled={retrying === d.id} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">{retrying === d.id ? 'Envoi…' : 'Réessayer'}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
