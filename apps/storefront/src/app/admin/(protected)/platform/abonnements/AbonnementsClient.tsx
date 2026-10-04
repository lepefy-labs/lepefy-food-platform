'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { PlatformSubscriptionRow, SubscriptionHistory } from '@/lib/billing/platformSubscriptions';
import {
  MODULE_KEYS,
  MODULE_LABELS,
  autoSuspendAt,
  formatBillingDate,
  isSuspendedAt,
  nextPaidUntil,
  plural,
  subscriptionState,
  type SubscriptionRow,
  type SubscriptionStateKind,
} from '@/lib/billing/subscriptionRules';

const INPUT = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const LABEL = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';
const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-[var(--admin-primary)] text-white hover:opacity-90`;
const SECONDARY = `${BUTTON} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`;
const DANGER = `${BUTTON} border border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300`;

const STATE_BADGE: Record<SubscriptionStateKind, { label: string; cls: string }> = {
  suspended: { label: 'Suspendu', cls: 'bg-red-100 text-red-700' },
  overdue: { label: 'En retard', cls: 'bg-amber-100 text-amber-800' },
  due_soon: { label: 'À renouveler', cls: 'bg-amber-50 text-amber-700' },
  active: { label: 'Actif', cls: 'bg-green-100 text-green-700' },
  undefined: { label: 'Échéance non définie', cls: 'bg-gray-100 text-gray-600' },
};

const AUDIT_LABEL: Record<string, string> = {
  payment_recorded: 'Paiement enregistré',
  suspend: 'Suspension',
  reactivate: 'Réactivation',
  set_paid_until: 'Échéance corrigée',
  set_payment_link: 'Lien Stripe modifié',
  set_suspension_policy: 'Politique de suspension',
  suspend_module: 'Module suspendu',
  reactivate_module: 'Module réactivé',
};

const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);

function toRow(row: PlatformSubscriptionRow): SubscriptionRow {
  return {
    status: row.status,
    suspended_at: row.suspendedAt,
    suspension_mode: row.suspensionMode,
    paid_until: row.paidUntil,
    grace_days: row.graceDays,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ReasonInput({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>Motif (obligatoire, tracé)</label>
      <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Ex. virement reçu, accord de paiement…" className={INPUT} />
    </div>
  );
}

function ManagePanel({ row, schemaReady }: { row: PlatformSubscriptionRow; schemaReady: boolean }) {
  const router = useRouter();
  const [history, setHistory] = useState<SubscriptionHistory | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  const [amount, setAmount] = useState(row.monthlyPriceCents !== null ? (row.monthlyPriceCents / 100).toFixed(2) : '');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [note, setNote] = useState('');
  const [statusReason, setStatusReason] = useState('');
  const [newPaidUntil, setNewPaidUntil] = useState(row.paidUntil ? row.paidUntil.slice(0, 10) : todayIso());
  const [paidUntilReason, setPaidUntilReason] = useState('');
  const [mode, setMode] = useState(row.suspensionMode);
  const [graceDays, setGraceDays] = useState(String(row.graceDays));
  const [policyReason, setPolicyReason] = useState('');
  const [link, setLink] = useState(row.stripePaymentLink ?? '');
  const [linkReason, setLinkReason] = useState('');
  const [moduleReason, setModuleReason] = useState('');

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/platform/subscriptions/${row.tenantId}`, { cache: 'no-store' });
      if (res.ok) setHistory(await res.json());
    } catch { /* history stays hidden */ }
  }, [row.tenantId]);

  useEffect(() => { if (schemaReady) void loadHistory(); }, [schemaReady, loadHistory]);

  async function run(key: string, body: Record<string, unknown>, success: string, reset?: () => void) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/platform/subscriptions/${row.tenantId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: data.error ?? 'Opération impossible.', tone: 'error' });
        return;
      }
      setMessage({ text: data.paidUntil ? `${success} Nouvelle échéance : ${formatBillingDate(data.paidUntil)}.` : success, tone: 'ok' });
      reset?.();
      router.refresh();
      void loadHistory();
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (!schemaReady) {
    return <p className="text-sm text-amber-700">Migration 144 non appliquée : la gestion des abonnements est en lecture seule.</p>;
  }

  const subscription = toRow(row);
  const transferDate = new Date(`${paidOn}T12:00:00Z`);
  const transferPreview = row.hasSubscription && !Number.isNaN(transferDate.getTime())
    ? nextPaidUntil(row.paidUntil ? new Date(row.paidUntil) : null, transferDate, isSuspendedAt(subscription, transferDate).suspended)
    : null;
  const policyPreview = mode === 'automatic' && row.paidUntil
    ? autoSuspendAt({ suspension_mode: 'automatic', paid_until: row.paidUntil, grace_days: Number(graceDays) || 0 })
    : null;
  const manualSuspended = row.status === 'suspended';

  return (
    <div className="space-y-5">
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </p>
      )}

      {!row.hasSubscription && (
        <p className="text-sm text-gray-500">Aucun abonnement (tenant_subscriptions) pour ce tenant : seuls les modules peuvent être suspendus.</p>
      )}

      {row.hasSubscription && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-3 text-sm font-semibold">Enregistrer un virement</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`amount-${row.tenantId}`} className={LABEL}>Montant (€)</label>
                <input id={`amount-${row.tenantId}`} type="number" step="0.01" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor={`paid-on-${row.tenantId}`} className={LABEL}>Date du virement</label>
                <input id={`paid-on-${row.tenantId}`} type="date" max={todayIso()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={INPUT} />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor={`note-${row.tenantId}`} className={LABEL}>Note (référence bancaire…)</label>
              <input id={`note-${row.tenantId}`} type="text" value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} />
            </div>
            {transferPreview && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                → Nouvelle échéance : <strong>{formatBillingDate(transferPreview)}</strong>
                {isSuspendedAt(subscription, transferDate).suspended && row.paidUntil && new Date(row.paidUntil) < transferDate && ' (tenant suspendu : les mois sans service ne sont pas facturés)'}
              </p>
            )}
            <button
              type="button"
              disabled={busy !== null || !(Number(amount) >= 0) || amount.trim() === ''}
              onClick={() => void run('transfer', { action: 'record_transfer', amountEur: Number(amount), paidOn, note: note || undefined }, 'Virement enregistré.', () => setNote(''))}
              className={`${PRIMARY} mt-3`}
            >
              {busy === 'transfer' ? 'Enregistrement…' : 'Enregistrer le virement'}
            </button>
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-1 text-sm font-semibold">Statut</h3>
            <p className="mb-3 text-xs text-gray-500">
              Une suspension met hors ligne boutique, événementiel, carte digitale, paiements en ligne, Nala et avis ; l&apos;admin du tenant
              est limitée à l&apos;abonnement et aux commandes en lecture. Les paiements déjà engagés restent traités.
            </p>
            <ReasonInput id={`status-reason-${row.tenantId}`} value={statusReason} onChange={setStatusReason} />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run(manualSuspended ? 'reactivate' : 'suspend', { action: manualSuspended ? 'reactivate' : 'suspend', reason: statusReason }, manualSuspended ? 'Tenant réactivé.' : 'Tenant suspendu.', () => setStatusReason(''))}
              className={`${manualSuspended ? PRIMARY : DANGER} mt-3`}
            >
              {manualSuspended ? 'Réactiver' : 'Suspendre maintenant'}
            </button>
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-1 text-sm font-semibold">Suspension automatique</h3>
            <p className="mb-3 text-xs text-gray-500">En mode automatique, le tenant est suspendu N jours après l&apos;échéance s&apos;il n&apos;a pas payé (avertissements 7 jours avant).</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`mode-${row.tenantId}`} className={LABEL}>Mode</label>
                <select id={`mode-${row.tenantId}`} value={mode} onChange={(e) => setMode(e.target.value === 'automatic' ? 'automatic' : 'manual')} className={INPUT}>
                  <option value="manual">Manuelle uniquement</option>
                  <option value="automatic">Automatique</option>
                </select>
              </div>
              <div>
                <label htmlFor={`grace-${row.tenantId}`} className={LABEL}>Jours après l&apos;échéance</label>
                <input id={`grace-${row.tenantId}`} type="number" min={0} max={365} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} disabled={mode !== 'automatic'} className={INPUT} />
              </div>
            </div>
            {policyPreview && (
              <p className={`mt-2 text-xs ${policyPreview.getTime() < Date.now() ? 'text-red-700' : 'text-gray-600 dark:text-gray-300'}`}>
                → Suspension automatique {policyPreview.getTime() < Date.now() ? 'immédiate (échéance déjà dépassée)' : `le ${formatBillingDate(policyPreview)}`}
              </p>
            )}
            <div className="mt-3"><ReasonInput id={`policy-reason-${row.tenantId}`} value={policyReason} onChange={setPolicyReason} /></div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('policy', { action: 'set_suspension_policy', mode, graceDays: Number(graceDays) || 0, reason: policyReason }, 'Politique enregistrée.', () => setPolicyReason(''))}
              className={`${SECONDARY} mt-3`}
            >
              Enregistrer la politique
            </button>
          </section>

          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-3 text-sm font-semibold">Échéance et lien de paiement</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`paid-until-${row.tenantId}`} className={LABEL}>Abonnement payé jusqu&apos;au</label>
                <input id={`paid-until-${row.tenantId}`} type="date" value={newPaidUntil} onChange={(e) => setNewPaidUntil(e.target.value)} className={INPUT} />
              </div>
              <ReasonInput id={`paid-until-reason-${row.tenantId}`} value={paidUntilReason} onChange={setPaidUntilReason} />
            </div>
            <button
              type="button"
              disabled={busy !== null || !newPaidUntil}
              onClick={() => void run('paid-until', { action: 'set_paid_until', paidUntil: newPaidUntil, reason: paidUntilReason }, 'Échéance corrigée.', () => setPaidUntilReason(''))}
              className={`${SECONDARY} mt-3`}
            >
              Corriger l&apos;échéance
            </button>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
              <div>
                <label htmlFor={`link-${row.tenantId}`} className={LABEL}>Lien Stripe (vide = aucun)</label>
                <input id={`link-${row.tenantId}`} type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://buy.stripe.com/…" className={INPUT} />
              </div>
              <ReasonInput id={`link-reason-${row.tenantId}`} value={linkReason} onChange={setLinkReason} />
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('link', { action: 'set_payment_link', url: link.trim() || null, reason: linkReason }, 'Lien de paiement enregistré.', () => setLinkReason(''))}
              className={`${SECONDARY} mt-3`}
            >
              Enregistrer le lien
            </button>
          </section>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <h3 className="mb-1 text-sm font-semibold">Modules</h3>
        <p className="mb-3 text-xs text-gray-500">Suspendre un seul module, indépendamment de l&apos;échéance (ex. événementiel hors ligne, boutique active).</p>
        <div className="mb-3 max-w-md"><ReasonInput id={`module-reason-${row.tenantId}`} value={moduleReason} onChange={setModuleReason} /></div>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {MODULE_KEYS.map((module) => {
            const suspension = row.suspendedModules.find((item) => item.module === module);
            return (
              <li key={module} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {MODULE_LABELS[module]}{' '}
                  {suspension
                    ? <span className="text-xs text-red-700">· suspendu depuis le {formatBillingDate(suspension.since)} ({suspension.reason})</span>
                    : <span className="text-xs text-gray-400">· actif</span>}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run(`module-${module}`, { action: suspension ? 'reactivate_module' : 'suspend_module', module, reason: moduleReason }, suspension ? 'Module réactivé.' : 'Module suspendu.', () => setModuleReason(''))}
                  className={suspension ? SECONDARY : DANGER}
                >
                  {suspension ? 'Réactiver' : 'Suspendre'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {history && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-2 text-sm font-semibold">Paiements</h3>
            {history.payments.length === 0 ? <p className="text-xs text-gray-400">Aucun paiement enregistré.</p> : (
              <ul className="space-y-1.5 text-xs">
                {history.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                    <span>{formatBillingDate(payment.paidAt)} · {payment.source === 'stripe' ? 'Carte' : 'Virement'} · {euro(payment.amountCents, payment.currency)}</span>
                    <span className="text-gray-500">→ {formatBillingDate(payment.paidUntilAfter)}{payment.wasSuspended ? ' (après suspension)' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <h3 className="mb-2 text-sm font-semibold">Journal</h3>
            {history.audit.length === 0 ? <p className="text-xs text-gray-400">Aucune action.</p> : (
              <ul className="space-y-1.5 text-xs">
                {history.audit.map((entry) => (
                  <li key={entry.id}>
                    <span className="text-gray-400">{new Date(entry.createdAt).toLocaleString('fr-FR')}</span>{' '}
                    · {AUDIT_LABEL[entry.action] ?? entry.action}
                    {entry.moduleKey ? ` (${MODULE_LABELS[entry.moduleKey as keyof typeof MODULE_LABELS] ?? entry.moduleKey})` : ''}
                    {entry.reason ? <span className="text-gray-500"> — {entry.reason}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function AbonnementsClient({ initialRows, schemaReady }: { initialRows: PlatformSubscriptionRow[]; schemaReady: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {!schemaReady && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Migration 144 non appliquée : suspension, paiements et journal sont indisponibles. Les tenants sont considérés actifs.
        </p>
      )}
      {initialRows.map((row) => {
        const state = subscriptionState(row.hasSubscription ? toRow(row) : null);
        const badge = STATE_BADGE[state.kind];
        const open = openId === row.tenantId;
        return (
          <div key={row.tenantId} className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : row.tenantId)}
              className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left sm:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] sm:items-center"
            >
              <span className="flex min-w-0 items-center gap-2">
                {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">{row.name}</span>
                  <span className="block truncate text-xs text-gray-400">{row.slug}{row.planName ? ` · ${row.planName}` : ''}{row.monthlyPriceCents !== null ? ` · ${euro(row.monthlyPriceCents, row.currency)}/mois` : ''}</span>
                </span>
              </span>
              <span><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}{state.kind === 'suspended' && state.suspendedBy === 'automatic' ? ' (auto)' : ''}</span></span>
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {formatBillingDate(row.paidUntil)}
                {state.kind === 'overdue' && <span className="block text-xs text-amber-700">retard {plural(state.daysOverdue, 'jour')}</span>}
              </span>
              <span className="text-xs text-gray-500">
                {row.suspensionMode === 'automatic' ? `Auto, ${plural(row.graceDays, 'jour')} après l’échéance` : 'Suspension manuelle'}
                {state.autoSuspendAt && state.kind !== 'suspended' && <span className="block">prévue le {formatBillingDate(state.autoSuspendAt)}</span>}
                {row.suspendedModules.length > 0 && <span className="block text-red-700">{plural(row.suspendedModules.length, 'module suspendu', 'modules suspendus')}</span>}
              </span>
              <span className="text-xs text-gray-500">
                {row.lastPayment ? `Dernier paiement ${formatBillingDate(row.lastPayment.paidAt)}` : 'Aucun paiement'}
              </span>
            </button>
            {open && (
              <div className="border-t border-gray-100 px-4 py-4 dark:border-gray-800">
                <ManagePanel row={row} schemaReady={schemaReady} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
