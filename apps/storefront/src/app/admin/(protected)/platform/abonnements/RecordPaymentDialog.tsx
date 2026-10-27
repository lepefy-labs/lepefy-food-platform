'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { IconBrandPaypal, IconBuildingBank, IconReceipt } from '@tabler/icons-react';
import Dialog from '@/app/admin/_components/ui/Dialog';
import Button from '@/app/admin/_components/ui/Button';
import InlineAlert from '@/app/admin/_components/ui/InlineAlert';
import { FormField, Input } from '@/app/admin/_components/ui/Form';
import { useConfirm } from '@/app/admin/_components/ui/ConfirmDialog';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { useAdminToast } from '@/app/admin/_components/ui/Toaster';
import type { PlatformSubscriptionRow, SubscriptionHistory } from '@/lib/billing/platformSubscriptions';
import { recordPaymentIssue } from '@/lib/billing/platformSubscriptionActions';
import {
  formatBillingDate,
  formatBillingMonth,
  isSuspendedAt,
  nextPaidUntil,
  paymentSourceLabel,
  type SubscriptionRow,
} from '@/lib/billing/subscriptionRules';

type Method = 'bank_transfer' | 'paypal';

const METHODS: Array<{ value: Method; label: string; icon: typeof IconBuildingBank }> = [
  { value: 'bank_transfer', label: 'Virement', icon: IconBuildingBank },
  { value: 'paypal', label: 'PayPal', icon: IconBrandPaypal },
];

/** A payment of the same tenant received within this many days is flagged as a possible double entry (a monthly payment is ~30 days apart). */
const DUPLICATE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const euro = (cents: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** « 89 », « 89,00 », « 89.5 » → cents; null when not a positive amount. */
function parseAmountCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

interface RecordPaymentDialogProps {
  open: boolean;
  onClose: () => void;
  row: PlatformSubscriptionRow;
  subscription: SubscriptionRow;
  /** Payments already recorded for this tenant (possible duplicates). */
  payments: SubscriptionHistory['payments'];
  onRecorded: () => void;
}

/**
 * A payment received outside Stripe (bank transfer or PayPal), confirmed by
 * the platform once the money is there — never on the tenant's word. One
 * request key per attempt (useAdminMutation withKey): a double click or a
 * retry records it once; the same reference is refused by the server.
 */
export default function RecordPaymentDialog({ open, onClose, row, subscription, payments, onRecorded }: RecordPaymentDialogProps) {
  const mutation = useAdminMutation();
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();
  const [method, setMethod] = useState<Method>('bank_transfer');
  const [amount, setAmount] = useState(row.monthlyPriceCents !== null ? (row.monthlyPriceCents / 100).toFixed(2).replace('.', ',') : '');
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; paidOn?: string; reference?: string }>({});

  const paidAt = new Date(`${paidOn}T12:00:00Z`);
  const validDate = !Number.isNaN(paidAt.getTime());
  const preview = useMemo(() => {
    if (!validDate) return null;
    const suspended = isSuspendedAt(subscription, paidAt).suspended;
    const until = nextPaidUntil(subscription.paid_until ? new Date(subscription.paid_until) : null, paidAt, suspended);
    return { until, month: new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1)), suspendedArrears: suspended && subscription.paid_until !== null && new Date(subscription.paid_until) < paidAt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidOn, subscription]);

  const nearby = validDate
    ? payments.filter((payment) => Math.abs(new Date(payment.paidAt).getTime() - paidAt.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS)
    : [];

  function close() {
    if (mutation.pending) return;
    mutation.setError(null);
    setErrors({});
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cents = parseAmountCents(amount);
    const next: typeof errors = {};
    if (cents === null || cents <= 0) next.amount = 'Indiquez le montant reçu, par exemple 89,00.';
    if (!validDate || paidOn > todayIso()) next.paidOn = 'Indiquez une date de réception passée ou du jour.';
    const referenceIssue = recordPaymentIssue({ method, reference });
    if (referenceIssue) next.reference = referenceIssue;
    setErrors(next);
    if (Object.keys(next).length > 0 || cents === null || !preview) return;

    const confirmed = await ask({
      title: `Confirmer la réception de ${euro(cents)} ?`,
      confirmLabel: 'Confirmer la réception',
      description: (
        <span className="block space-y-2">
          <span className="block">
            {paymentSourceLabel(method)} de <strong>{euro(cents)}</strong> reçu le <strong>{formatBillingDate(paidAt)}</strong>
            {reference.trim() && <> (réf. {reference.trim()})</>} pour <strong>{row.name}</strong>.
          </span>
          <span className="block">
            L&apos;échéance passe du {formatBillingDate(subscription.paid_until)} au <strong>{formatBillingDate(preview.until)}</strong> et le tenant reçoit une confirmation.
            Le paiement est tracé et ne se supprime pas depuis la console.
          </span>
          {nearby.length > 0 && (
            <span className="block font-semibold text-tone-warning-fg">
              Attention : {nearby.length === 1 ? 'un paiement a déjà été enregistré' : `${nearby.length} paiements ont déjà été enregistrés`} à moins de {DUPLICATE_WINDOW_DAYS} jours.
            </span>
          )}
        </span>
      ),
    });
    if (!confirmed) return;

    const result = await mutation.run<{ paidUntil: string | null; created?: boolean }>(`/api/admin/platform/subscriptions/${row.tenantId}`, {
      body: { action: 'record_payment', method, amountEur: cents / 100, paidOn, reference: reference.trim() || undefined, note: note.trim() || undefined },
      withKey: true,
    });
    if (!result) return;
    toast.success(result.created === false
      ? 'Ce paiement était déjà enregistré : échéance inchangée.'
      : `Paiement enregistré. Nouvelle échéance : ${formatBillingDate(result.paidUntil)}.`);
    setReference('');
    setNote('');
    onRecorded();
    onClose();
  }

  const formId = `record-payment-${row.tenantId}`;
  return (
    <>
      <Dialog
        open={open}
        onClose={close}
        dismissible={!mutation.pending}
        title="Enregistrer un paiement"
        description={`${row.name} · à enregistrer seulement une fois l’argent reçu sur le compte Lepefy.`}
        icon={<IconReceipt size={20} stroke={1.8} aria-hidden="true" />}
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={mutation.pending}>Annuler</Button>
            <Button type="submit" form={formId} loading={mutation.pending}>Enregistrer le paiement</Button>
          </>
        )}
      >
        <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-semibold text-a-text">Moyen de paiement</legend>
            <div role="radiogroup" className="inline-flex rounded-lg border border-a-border p-0.5">
              {METHODS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={method === value}
                  onClick={() => { setMethod(value); setErrors((current) => ({ ...current, reference: undefined })); }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus ${method === value ? 'bg-a-brand-soft text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover'}`}
                >
                  <Icon size={16} stroke={1.8} aria-hidden="true" />{label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Montant reçu (€)" required error={errors.amount}>
              <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="Date de réception" required error={errors.paidOn}>
              <Input type="date" max={todayIso()} value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
            </FormField>
          </div>

          <FormField
            label={method === 'paypal' ? 'N° de transaction PayPal' : 'Référence du virement'}
            required={method === 'paypal'}
            optional={method !== 'paypal'}
            hint={method === 'paypal'
              ? 'Visible dans le détail de la transaction PayPal. Une même transaction ne peut être enregistrée qu’une fois.'
              : 'Libellé ou référence du relevé bancaire, par exemple LEPEFY CHLOEFOOD 2026-11.'}
            error={errors.reference}
          >
            <Input value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} autoComplete="off" />
          </FormField>

          <FormField label="Note interne" optional>
            <Input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
          </FormField>

          {preview && (
            <InlineAlert tone="info" title={`Nouvelle échéance : ${formatBillingDate(preview.until)}`}>
              Ce paiement couvre {formatBillingMonth(preview.month)}.
              {preview.suspendedArrears && ' Tenant suspendu : les mois sans service ne sont pas facturés.'}
            </InlineAlert>
          )}
          {nearby.length > 0 && (
            <InlineAlert tone="warning" title="Paiement peut-être déjà enregistré">
              {nearby.map((payment) => `${paymentSourceLabel(payment.source)} de ${euro(payment.amountCents, payment.currency)} le ${formatBillingDate(payment.paidAt)}`).join(' · ')}.
              {' '}Vérifiez qu’il s’agit bien d’un nouveau paiement.
            </InlineAlert>
          )}
          {mutation.error && <InlineAlert tone="danger">{mutation.error}</InlineAlert>}
        </form>
      </Dialog>
      {confirmDialog}
    </>
  );
}
