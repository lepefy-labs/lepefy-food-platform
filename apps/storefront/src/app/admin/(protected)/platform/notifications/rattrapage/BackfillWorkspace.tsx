'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconBrandWhatsapp, IconEye, IconMail, IconSend } from '@tabler/icons-react';
import { formatDate, formatMoney, pluralize } from '@/lib/admin/format';
import { NOTIFICATION_BACKFILL_STATE_META, ORDER_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import type { BackfillRow, RunProgress } from '@/lib/notifications/staff/backfill';
import type { BackfillMode, BackfillPlan } from '@/lib/notifications/staff/backfillPlan';
import type { NotificationChannel } from '@/lib/notifications/notificationTypes';
import Badge from '../../../../_components/ui/Badge';
import Button from '../../../../_components/ui/Button';
import Dialog from '../../../../_components/ui/Dialog';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { useConfirm } from '../../../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../../../_components/ui/Toaster';
import { Card } from '../../../../_components/ui/Panel';
import { EmptyState } from '../../../../_components/ui/States';
import DataTable, { type DataColumn } from '../../../../_components/data/DataTable';
import { BulkBar, RowSelectionProvider } from '../../../../_components/data/RowSelection';

type Selection = { orderIds: string[] } | { allMatching: Record<string, string> };

function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `bf_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function indicators(row: BackfillRow) {
  return (
    <span className="flex flex-wrap gap-1">
      {row.priority !== 'normal' && <Badge tone="urgent">Prioritaire</Badge>}
      {row.international && <Badge tone="info">International</Badge>}
      {(row.fresh || row.frozen) && <Badge tone="info">{row.frozen && !row.fresh ? 'Surgelés' : 'Frais'}</Badge>}
      {row.paymentMethod === 'in_store' && <Badge tone="neutral">À encaisser</Badge>}
    </span>
  );
}

export function BackfillWorkspace({ rows, tenantId, tenantName, filters, actionableTotal, maxOrders, whatsapp, linkOrders }: {
  rows: BackfillRow[];
  tenantId: string;
  tenantName: string;
  filters: Record<string, string>;
  actionableTotal: number;
  maxOrders: number;
  whatsapp: { enabled: boolean; configured: boolean; recipients: number };
  linkOrders: boolean;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const columns: DataColumn<BackfillRow>[] = [
    { key: 'order', header: 'Commande', cell: (row) => linkOrders
      ? <Link href={`/admin/orders/${row.id}`} className="font-semibold text-a-brand-fg hover:underline">{row.orderNumber}</Link>
      : <span className="font-semibold text-a-text">{row.orderNumber}</span> },
    { key: 'date', header: 'Créée', cell: (row) => <span className="whitespace-nowrap text-a-text-2">{formatDate(row.createdAt, 'datetime')}</span> },
    { key: 'customer', header: 'Client', hideBelow: 'lg', cell: (row) => <span className="text-a-text-2">{row.customer ?? '—'}</span> },
    { key: 'total', header: 'Montant', align: 'right', cell: (row) => <span className="font-semibold">{formatMoney(row.total)}</span> },
    { key: 'status', header: 'Commande', cell: (row) => { const meta = statusMeta(ORDER_STATUS_META, row.status); return <Badge tone={meta.tone} dot>{meta.label}</Badge>; } },
    { key: 'flags', header: 'Indicateurs', hideBelow: 'md', cell: indicators },
    { key: 'notif', header: 'Notification Lepefy', cell: (row) => {
      const meta = statusMeta(NOTIFICATION_BACKFILL_STATE_META, row.state);
      return (
        <span className="flex flex-col gap-0.5">
          <Badge tone={meta.tone} dot>{meta.label}</Badge>
          {row.pairs > 0 && <span className="text-xs text-a-text-3">{row.sent}/{row.pairs} envoyées{row.uncertain ? ` · ${row.uncertain} incertaine(s)` : ''}</span>}
        </span>
      );
    } },
  ];

  const mobileCard = (row: BackfillRow) => {
    const meta = statusMeta(NOTIFICATION_BACKFILL_STATE_META, row.state);
    return (
      <div className="space-y-1.5 px-3 py-3 text-sm">
        <div className="flex items-center justify-between gap-2"><span className="font-semibold text-a-text">{row.orderNumber}</span><span className="font-semibold">{formatMoney(row.total)}</span></div>
        <div className="text-xs text-a-text-3">{formatDate(row.createdAt, 'datetime')}{row.customer ? ` · ${row.customer}` : ''}</div>
        {indicators(row)}
        <Badge tone={meta.tone} dot>{meta.label}</Badge>
      </div>
    );
  };

  const selectable = rows.filter((row) => row.missing > 0 || row.retry > 0);

  return (
    <RowSelectionProvider rowIds={selectable.map((row) => row.id)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-a-border px-4 py-3">
        <p className="text-sm text-a-text-2">{pluralize(actionableTotal, 'commande à notifier', 'commandes à notifier')} dans les résultats (max. {maxOrders} par envoi).</p>
        <Button variant="outline" size="sm" disabled={actionableTotal === 0} onClick={() => setSelection({ allMatching: filters })}>
          <IconEye size={16} aria-hidden="true" />Prévisualiser tous les résultats
        </Button>
      </div>
      <DataTable caption="Commandes ouvertes et état de leur notification" columns={columns} rows={rows} rowKey={(row) => row.id}
        selectable={{ label: (row) => `Sélectionner ${row.orderNumber}` }}
        rowTone={(row) => (row.state === 'failed' ? 'danger' : row.state === 'not_notified' ? 'warning' : undefined)}
        mobileCard={mobileCard} density="compact"
        empty={<EmptyState variant="filtered" title="Aucune commande ouverte pour ces critères" />} />
      <BulkBar rowIds={selectable.map((row) => row.id)} noun="commande sélectionnée" nounPlural="commandes sélectionnées">
        {(ids) => <Button size="sm" onClick={() => setSelection({ orderIds: ids })}><IconEye size={16} aria-hidden="true" />Prévisualiser l’envoi</Button>}
      </BulkBar>
      {selection && <PreviewDialog selection={selection} tenantId={tenantId} tenantName={tenantName} whatsapp={whatsapp} onClose={() => setSelection(null)} />}
    </RowSelectionProvider>
  );
}

interface PreviewResponse { runId: string; expiresAt: string; plan: BackfillPlan; warnings: string[] }

function PreviewDialog({ selection, tenantId, tenantName, whatsapp, onClose }: {
  selection: Selection; tenantId: string; tenantName: string;
  whatsapp: { enabled: boolean; configured: boolean; recipients: number }; onClose: () => void;
}) {
  const router = useRouter();
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();
  const whatsappUsable = whatsapp.enabled && whatsapp.configured;
  const [channels, setChannels] = useState<NotificationChannel[]>(whatsappUsable ? ['email', 'whatsapp'] : ['email']);
  const [mode, setMode] = useState<BackfillMode>('individual');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (channels.length === 0) { setPreview(null); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/admin/platform/notifications/backfill/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // A fresh key per preview: a confirmation only ever applies to what was shown.
        body: JSON.stringify({ tenantId, idempotencyKey: newKey(), channels, mode, ...selection }),
      });
      const body = await res.json().catch(() => null) as (PreviewResponse & { error?: string }) | null;
      if (!res.ok || !body?.runId) throw new Error(body?.error ?? 'Aperçu impossible');
      setPreview(body);
    } catch (err) { setPreview(null); setError(err instanceof Error ? err.message : 'Aperçu impossible'); } finally { setLoading(false); }
  }, [channels, mode, selection, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const plan = preview?.plan;
  const total = plan ? plan.messages.email + plan.messages.whatsapp : 0;
  const toggleChannel = (channel: NotificationChannel, on: boolean) => setChannels((prev) => on ? Array.from(new Set([...prev, channel])) : prev.filter((c) => c !== channel));
  const excludedByReason = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of plan?.excluded ?? []) map.set(item.reason, [...(map.get(item.reason) ?? []), item.orderNumber]);
    return Array.from(map.entries());
  }, [plan]);

  async function send() {
    if (!preview || !plan) return;
    const parts = [
      plan.messages.whatsapp > 0 ? `${pluralize(plan.messages.whatsapp, 'notification WhatsApp', 'notifications WhatsApp')}` : null,
      plan.messages.email > 0 ? `${pluralize(plan.messages.email, 'notification email', 'notifications email')}` : null,
    ].filter(Boolean).join(' et ');
    const ok = await ask({
      title: 'Confirmer l’envoi ?',
      description: `Vous allez envoyer ${parts} pour ${tenantName}${plan.mode === 'summary' ? ' (récapitulatif groupé)' : ''}. Les commandes déjà notifiées seront ignorées.`,
      confirmLabel: 'Envoyer les notifications',
    });
    if (!ok) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/platform/notifications/backfill/${preview.runId}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId }),
      });
      const body = await res.json().catch(() => null) as { queued?: number; retried?: number; accepted?: number; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Envoi impossible');
      toast.success(`Rattrapage lancé : ${(body?.queued ?? 0) + (body?.retried ?? 0)} message(s) en file, ${body?.accepted ?? 0} déjà accepté(s).`, {
        description: 'Le reste part avec le planificateur (toutes les 5 minutes). Suivi : « Derniers rattrapages » et Historique.',
      });
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Envoi impossible');
      if (err instanceof Error && /changé|expiré/.test(err.message)) void load();
    } finally { setSending(false); }
  }

  return (
    <>
      {confirmDialog}
      <Dialog open onClose={onClose} title="Aperçu du rattrapage" description={tenantName} size="lg" dismissible={!sending}
        footer={<>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Annuler</Button>
          <Button onClick={send} loading={sending} disabled={!plan || total === 0 || loading}><IconSend size={16} aria-hidden="true" />Envoyer les notifications</Button>
        </>}>
        <div className="space-y-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-semibold text-a-text">Canaux</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
              <input type="checkbox" className="h-5 w-5 accent-[var(--admin-primary)]" checked={channels.includes('email')} onChange={(e) => toggleChannel('email', e.target.checked)} /><IconMail size={16} aria-hidden="true" />Email
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2">
              <input type="checkbox" className="h-5 w-5 accent-[var(--admin-primary)] disabled:opacity-40" disabled={!whatsappUsable} checked={channels.includes('whatsapp')} onChange={(e) => toggleChannel('whatsapp', e.target.checked)} /><IconBrandWhatsapp size={16} aria-hidden="true" />WhatsApp{!whatsappUsable && <span className="text-xs text-a-text-3">(indisponible)</span>}
            </label>
          </fieldset>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-semibold text-a-text">Format</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2"><input type="radio" name="backfill-mode" className="h-5 w-5 accent-[var(--admin-primary)]" checked={mode === 'individual'} onChange={() => setMode('individual')} />Un message par commande</label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-a-text-2"><input type="radio" name="backfill-mode" className="h-5 w-5 accent-[var(--admin-primary)]" checked={mode === 'summary'} onChange={() => setMode('summary')} />Un récapitulatif par destinataire</label>
          </fieldset>

          {channels.length === 0 && <InlineAlert tone="warning">Choisissez au moins un canal.</InlineAlert>}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          {loading && <p className="text-sm text-a-text-3" aria-live="polite">Calcul de l’aperçu…</p>}
          {plan && !loading && (
            <>
              {preview?.warnings.map((warning) => <InlineAlert key={warning} tone="warning">{warning}</InlineAlert>)}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ['Commandes sélectionnées', plan.selected],
                  ['À notifier', plan.eligibleIds.length],
                  ['Exclues', plan.excluded.length],
                  ['Destinataires', plan.recipients],
                  ['Messages WhatsApp', plan.messages.whatsapp],
                  ['Messages email', plan.messages.email],
                ].map(([label, value]) => (
                  <div key={label as string} className="rounded-lg border border-a-border p-3">
                    <dt className="text-xs text-a-text-3">{label}</dt>
                    <dd className="text-2xl font-bold tabular-nums text-a-text">{value}</dd>
                  </div>
                ))}
              </dl>
              {plan.retries > 0 && <p className="text-sm text-a-text-2">Dont {pluralize(plan.retries, 'nouvel essai', 'nouveaux essais')} d’envois en échec (jamais de doublon).</p>}
              {excludedByReason.length > 0 && (
                <details className="rounded-lg border border-a-border p-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-a-text">Commandes exclues ({plan.excluded.length})</summary>
                  <ul className="mt-2 space-y-1.5">
                    {excludedByReason.map(([reason, numbers]) => (
                      <li key={reason} className="text-a-text-2"><span className="font-medium text-a-text">{reason}</span> · {numbers.slice(0, 20).join(', ')}{numbers.length > 20 ? ` … (+${numbers.length - 20})` : ''}</li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="text-xs text-a-text-3">Aperçu valable 15 minutes. Si une commande ou un destinataire change entre-temps, l’envoi est refusé et l’aperçu recalculé.</p>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

const RUN_STATUS: Record<string, string> = { confirmed: 'En cours', completed: 'Lancé' };

export function RecentRuns({ runs, tenantId }: { runs: RunProgress[]; tenantId: string }) {
  const router = useRouter();
  const toast = useAdminToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function process(runId: string, retryFailed: boolean) {
    setBusy(`${runId}:${retryFailed}`);
    try {
      const res = await fetch(`/api/admin/platform/notifications/backfill/${runId}/process`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId, retryFailed }),
      });
      const body = await res.json().catch(() => null) as { attempted?: number; accepted?: number; retried?: number; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'Erreur');
      toast.success(`${body?.attempted ?? 0} envoi(s) tenté(s), ${body?.accepted ?? 0} accepté(s)${retryFailed ? `, ${body?.retried ?? 0} relancé(s)` : ''}.`);
      router.refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Erreur'); } finally { setBusy(null); }
  }

  return (
    <Card>
      <div className="border-b border-a-border p-4">
        <h2 className="text-base font-semibold text-a-text">Derniers rattrapages</h2>
        <p className="mt-1 text-sm text-a-text-3">Qui a lancé quoi, et l’état réel de chaque envoi.</p>
      </div>
      {runs.length === 0 ? <EmptyState title="Aucun rattrapage lancé" /> : (
        <ul className="divide-y divide-a-border">
          {runs.map((run) => {
            const pending = (run.deliveries.pending ?? 0) + (run.deliveries.processing ?? 0);
            const failedCount = (run.deliveries.failed ?? 0) + (run.deliveries.dead ?? 0);
            return (
              <li key={run.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-a-text">
                    {formatDate(run.confirmedAt ?? run.createdAt, 'datetime')} · {pluralize(run.orders, 'commande', 'commandes')} · {run.mode === 'summary' ? 'récapitulatif' : 'un message par commande'} · {run.channels.map((c) => (c === 'whatsapp' ? 'WhatsApp' : 'Email')).join(' + ')}
                  </p>
                  <p className="text-xs text-a-text-3">
                    {RUN_STATUS[run.status] ?? run.status}{run.createdBy ? ` par ${run.createdBy}` : ''} ·{' '}
                    {Object.entries(run.deliveries).map(([status, n]) => `${n} ${statusMeta({ pending: { label: 'en file', tone: 'info' }, processing: { label: 'en cours', tone: 'info' }, accepted: { label: 'accepté(s)', tone: 'success' }, delivered: { label: 'délivré(s)', tone: 'success' }, failed: { label: 'en échec', tone: 'warning' }, dead: { label: 'abandonné(s)', tone: 'danger' }, unknown: { label: 'incertain(s)', tone: 'urgent' }, skipped: { label: 'non envoyé(s)', tone: 'neutral' }, purged: { label: 'archivé(s)', tone: 'neutral' } }, status).label}`).join(' · ') || 'aucun envoi'}
                  </p>
                </div>
                {pending > 0 && <Button variant="outline" size="sm" loading={busy === `${run.id}:false`} onClick={() => process(run.id, false)}>Traiter maintenant</Button>}
                {failedCount > 0 && <Button variant="outline" size="sm" loading={busy === `${run.id}:true`} onClick={() => process(run.id, true)}>Relancer les échecs</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
