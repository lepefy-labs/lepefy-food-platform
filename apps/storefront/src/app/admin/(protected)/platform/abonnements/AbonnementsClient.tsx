'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconBrandPaypal, IconChevronDown, IconChevronRight, IconReceipt } from '@tabler/icons-react';
import type { PlatformSubscriptionRow, SubscriptionHistory } from '@/lib/billing/platformSubscriptions';
import {
  MODULE_KEYS,
  MODULE_LABELS,
  autoSuspendAt,
  formatBillingDate,
  paymentSourceLabel,
  plural,
  subscriptionState,
  type SubscriptionRow,
} from '@/lib/billing/subscriptionRules';
import { nextDueReminder, REMINDER_KIND_LABELS } from '@/lib/billing/subscriptionReminders';
import { SUBSCRIPTION_REMINDER_STATUS_META, SUBSCRIPTION_STATE_META } from '@/lib/admin/statusRegistry';
import Badge from '@/app/admin/_components/ui/Badge';
import Button from '@/app/admin/_components/ui/Button';
import { FormField, Input } from '@/app/admin/_components/ui/Form';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import RecordPaymentDialog from './RecordPaymentDialog';
import { labelClasses } from '@/app/admin/_components/ui/Form';

const INPUT = 'w-full rounded-lg border border-a-field bg-a-surface px-3 py-2 text-sm text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus';
const LABEL = labelClasses;
const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-a-brand text-a-on-brand hover:opacity-90`;
const SECONDARY = `${BUTTON} border border-a-border text-a-text-2 hover:bg-a-surface-2`;
const DANGER = `${BUTTON} border border-tone-danger-border text-tone-danger-fg hover:bg-tone-danger-bg`;

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

  const [paymentOpen, setPaymentOpen] = useState(false);
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
    return <p className="text-sm text-tone-warning-fg">Migration 144 non appliquée : la gestion des abonnements est en lecture seule.</p>;
  }

  const subscription = toRow(row);
  const policyPreview = mode === 'automatic' && row.paidUntil
    ? autoSuspendAt({ suspension_mode: 'automatic', paid_until: row.paidUntil, grace_days: Number(graceDays) || 0 })
    : null;
  const manualSuspended = row.status === 'suspended';

  return (
    <div className="space-y-5">
      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>
          {message.text}
        </p>
      )}

      {!row.hasSubscription && (
        <p className="text-sm text-a-text-3">Aucun abonnement (tenant_subscriptions) pour ce tenant : seuls les modules peuvent être suspendus.</p>
      )}

      {row.hasSubscription && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-a-border p-4">
            <h3 className="mb-1 text-sm font-semibold">Paiements reçus hors Stripe</h3>
            <p className="mb-3 text-xs text-a-text-3">
              Virement ou PayPal, à enregistrer une fois l&apos;argent reçu sur le compte Lepefy : l&apos;échéance est prolongée
              automatiquement et le tenant reçoit une confirmation. Les paiements par carte (Stripe) s&apos;enregistrent seuls.
            </p>
            <Button onClick={() => setPaymentOpen(true)}>
              <IconReceipt size={16} stroke={1.8} aria-hidden="true" />Enregistrer un paiement
            </Button>
            <RecordPaymentDialog
              open={paymentOpen}
              onClose={() => setPaymentOpen(false)}
              row={row}
              subscription={subscription}
              payments={history?.payments ?? []}
              onRecorded={() => void loadHistory()}
            />
          </section>

          <section className="rounded-xl border border-a-border p-4">
            <h3 className="mb-1 text-sm font-semibold">Statut</h3>
            <p className="mb-3 text-xs text-a-text-3">
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

          <section className="rounded-xl border border-a-border p-4">
            <h3 className="mb-1 text-sm font-semibold">Suspension automatique</h3>
            <p className="mb-3 text-xs text-a-text-3">En mode automatique, le tenant est suspendu N jours après l&apos;échéance s&apos;il n&apos;a pas payé (avertissements 7 jours avant).</p>
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
              <p className={`mt-2 text-xs ${policyPreview.getTime() < Date.now() ? 'text-tone-danger-fg' : 'text-a-text-2'}`}>
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

          <section className="rounded-xl border border-a-border p-4">
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
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-a-border pt-4">
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

      <section className="rounded-xl border border-a-border p-4">
        <h3 className="mb-1 text-sm font-semibold">Modules</h3>
        <p className="mb-3 text-xs text-a-text-3">Suspendre un seul module, indépendamment de l&apos;échéance (ex. événementiel hors ligne, boutique active).</p>
        <div className="mb-3 max-w-md"><ReasonInput id={`module-reason-${row.tenantId}`} value={moduleReason} onChange={setModuleReason} /></div>
        <ul className="divide-y divide-a-border">
          {MODULE_KEYS.map((module) => {
            const suspension = row.suspendedModules.find((item) => item.module === module);
            return (
              <li key={module} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {MODULE_LABELS[module]}{' '}
                  {suspension
                    ? <span className="text-xs text-tone-danger-fg">· suspendu depuis le {formatBillingDate(suspension.since)} ({suspension.reason})</span>
                    : <span className="text-xs text-a-text-3">· actif</span>}
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
          <section className="rounded-xl border border-a-border p-4">
            <h3 className="mb-2 text-sm font-semibold">Paiements</h3>
            {history.payments.length === 0 ? <p className="text-xs text-a-text-3">Aucun paiement enregistré.</p> : (
              <ul className="space-y-1.5 text-xs">
                {history.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                    <span>{formatBillingDate(payment.paidAt)} · {paymentSourceLabel(payment.source)} · {euro(payment.amountCents, payment.currency)}{payment.externalReference ? ` · réf. ${payment.externalReference}` : ''}</span>
                    <span className="text-a-text-3">→ {formatBillingDate(payment.paidUntilAfter)}{payment.wasSuspended ? ' (après suspension)' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-a-border p-4">
            <h3 className="mb-2 text-sm font-semibold">Journal</h3>
            {history.audit.length === 0 ? <p className="text-xs text-a-text-3">Aucune action.</p> : (
              <ul className="space-y-1.5 text-xs">
                {history.audit.map((entry) => (
                  <li key={entry.id}>
                    <span className="text-a-text-3">{new Date(entry.createdAt).toLocaleString('fr-FR')}</span>{' '}
                    · {AUDIT_LABEL[entry.action] ?? entry.action}
                    {entry.moduleKey ? ` (${MODULE_LABELS[entry.moduleKey as keyof typeof MODULE_LABELS] ?? entry.moduleKey})` : ''}
                    {entry.reason ? <span className="text-a-text-3"> — {entry.reason}</span> : null}
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

/** Lepefy's PayPal link, shown to every tenant on its Abonnement page (amount prefilled for a PayPal.me link). */
function PaypalSettings({ paypalUrl }: { paypalUrl: string | null }) {
  const mutation = useAdminMutation();
  const [value, setValue] = useState(paypalUrl ?? '');
  const dirty = value.trim() !== (paypalUrl ?? '');
  return (
    <section className="rounded-2xl border border-a-border bg-a-surface p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-a-text">
        <IconBrandPaypal size={18} stroke={1.8} aria-hidden="true" />Lien PayPal Lepefy
      </h2>
      <p className="mb-3 text-xs text-a-text-3">
        Affiché à tous les tenants sur leur page Abonnement, à côté de la carte et du virement. Avec un lien PayPal.me, le montant du plan est prérempli.
        Vide = pas de PayPal proposé.
      </p>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void mutation.run('/api/admin/platform/subscriptions/settings', {
            body: { paypalUrl: value.trim() || null },
            successMessage: value.trim() ? 'Lien PayPal enregistré.' : 'Lien PayPal retiré.',
          });
        }}
      >
        <FormField label="Lien PayPal" optional error={mutation.error ?? undefined} className="flex-1">
          <Input type="url" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://paypal.me/lepefy" />
        </FormField>
        <Button type="submit" variant="secondary" loading={mutation.pending} disabled={!dirty}>Enregistrer le lien</Button>
      </form>
    </section>
  );
}

function ReminderCell({ row, subscription }: { row: PlatformSubscriptionRow; subscription: SubscriptionRow }) {
  const next = row.hasSubscription ? nextDueReminder(subscription) : null;
  const last = row.lastReminder;
  const status = last ? SUBSCRIPTION_REMINDER_STATUS_META[last.status] : null;
  return (
    <span className="text-xs text-a-text-3">
      {last && status
        ? <span className="flex flex-wrap items-center gap-1.5"><Badge tone={status.tone}>{REMINDER_KIND_LABELS[last.kind]} · {status.label}</Badge>{formatBillingDate(last.at)}</span>
        : <span className="block">Aucun rappel envoyé</span>}
      {next && <span className="block">Prochain : {REMINDER_KIND_LABELS[next.kind]} le {formatBillingDate(next.on)}</span>}
    </span>
  );
}

export default function AbonnementsClient({ initialRows, schemaReady, paypalUrl }: { initialRows: PlatformSubscriptionRow[]; schemaReady: boolean; paypalUrl: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {!schemaReady && (
        <p role="status" className="rounded-xl border border-tone-warning-border bg-tone-warning-bg px-4 py-3 text-sm text-tone-warning-fg">
          Migration 144 non appliquée : suspension, paiements et journal sont indisponibles. Les tenants sont considérés actifs.
        </p>
      )}
      {initialRows.length === 0 && (
        <p className="rounded-2xl border border-a-border bg-a-surface px-4 py-6 text-center text-sm text-a-text-3">Aucun tenant dans cette vue.</p>
      )}
      {initialRows.map((row) => {
        const subscription = toRow(row);
        const state = subscriptionState(row.hasSubscription ? subscription : null);
        const badge = SUBSCRIPTION_STATE_META[state.kind];
        const open = openId === row.tenantId;
        return (
          <div key={row.tenantId} className="rounded-2xl border border-a-border bg-a-surface">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : row.tenantId)}
              className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left sm:grid-cols-[1.4fr_1fr_1fr_1.4fr_1.1fr] sm:items-center"
            >
              <span className="flex min-w-0 items-center gap-2">
                {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-a-text">{row.name}</span>
                  <span className="block truncate text-xs text-a-text-3">{row.slug}{row.planName ? ` · ${row.planName}` : ''}{row.monthlyPriceCents !== null ? ` · ${euro(row.monthlyPriceCents, row.currency)}/mois` : ''}</span>
                </span>
              </span>
              <span><Badge tone={badge.tone} dot>{badge.label}{state.kind === 'suspended' && state.suspendedBy === 'automatic' ? ' (auto)' : ''}</Badge></span>
              <span className="text-sm text-a-text-2">
                {formatBillingDate(row.paidUntil)}
                {state.kind === 'overdue' && <span className="block text-xs text-tone-warning-fg">retard {plural(state.daysOverdue, 'jour')}</span>}
                {state.kind === 'due_soon' && state.daysLeft !== null && <span className="block text-xs text-tone-warning-fg">{state.daysLeft === 0 ? 'aujourd’hui' : `dans ${plural(state.daysLeft, 'jour')}`}</span>}
                <span className="block text-xs text-a-text-3">
                  {row.suspensionMode === 'automatic' ? `Suspension auto ${plural(row.graceDays, 'jour')} après` : 'Suspension manuelle'}
                  {row.suspendedModules.length > 0 && <span className="block text-tone-danger-fg">{plural(row.suspendedModules.length, 'module suspendu', 'modules suspendus')}</span>}
                </span>
              </span>
              <ReminderCell row={row} subscription={subscription} />
              <span className="text-xs text-a-text-3">
                {row.lastPayment ? `${paymentSourceLabel(row.lastPayment.source)} ${euro(row.lastPayment.amountCents)} le ${formatBillingDate(row.lastPayment.paidAt)}` : 'Aucun paiement'}
              </span>
            </button>
            {open && (
              <div className="border-t border-a-border px-4 py-4">
                <ManagePanel row={row} schemaReady={schemaReady} />
              </div>
            )}
          </div>
        );
      })}
      <PaypalSettings paypalUrl={paypalUrl} />
    </div>
  );
}
